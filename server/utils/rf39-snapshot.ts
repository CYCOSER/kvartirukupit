import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createError } from 'h3';
import { z } from 'zod';
import { fetchRf39Feed, rf39FeedUrl, type Rf39Snapshot } from './rf39';
import { rf39ObjectSchema } from './rf39-data';

const MAX_BYTES = 128 * 1024 * 1024;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const envelope = z.object({
  version: z.literal(2), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotDate: z.string().datetime(), authoritative: z.boolean(),
  items: z.array(rf39ObjectSchema).max(20000), presentIds: z.array(id).max(20000),
  errors: z.array(z.object({ id: id.nullable(), message: z.string().max(1000) })).max(40000),
});
let cached: { key: string; signature: string; snapshot: Rf39Snapshot } | undefined;
const refreshing = new Map<string, Promise<Rf39Snapshot>>();

async function readSnapshot(path: string, sourceHash: string): Promise<Rf39Snapshot | null> {
  let file;
  try { file = await open(path, 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Invalid snapshot size');
    const key = `${path}\0${sourceHash}`, signature = `${info.ino}\0${info.mtimeMs}\0${info.size}`;
    if (cached?.key === key && cached.signature === signature) return cached.snapshot;
    const bytes = await file.readFile();
    if (bytes.length > MAX_BYTES) throw new Error('Invalid snapshot size');
    const raw = JSON.parse(bytes.toString('utf8'));
    if (raw.version === 1) return null;
    const saved = envelope.parse(raw);
    if (saved.sourceHash !== sourceHash) return null;
    const present = new Set(saved.presentIds);
    if ((!present.size && saved.authoritative) || (!saved.items.length && !saved.errors.length) || present.size !== saved.presentIds.length || new Set(saved.items.map(item => item.id)).size !== saved.items.length ||
        saved.items.some(item => !present.has(item.id)) || saved.errors.some(error => error.id !== null && !present.has(error.id)) ||
        saved.authoritative && saved.errors.some(error => error.id === null)) throw new Error('Invalid snapshot identities');
    const { version: _version, sourceHash: _sourceHash, ...snapshot } = saved;
    const incompleteImages = new Set(saved.errors.filter(error => error.message.startsWith('Часть фотографий пропущена:')).map(error => error.id));
    for (const item of snapshot.items) if (incompleteImages.has(item.id)) item.imagesIncomplete = true;
    cached = { key, signature, snapshot };
    return snapshot;
  } finally { await file.close(); }
}

function refreshSnapshot(path: string, source: string, sourceHash: string) {
  const key = `${path}\0${sourceHash}`;
  const pending = refreshing.get(key);
  if (pending) return pending;
  const promise = (async () => {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const snapshot = await fetchRf39Feed(source, true);
      const data = JSON.stringify({ version: 2, sourceHash, ...snapshot });
      if (Buffer.byteLength(data) > MAX_BYTES) throw new Error('Snapshot exceeds limit');
      await mkdir(dirname(path), { recursive: true });
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      await rename(temporary, path);
      cached = undefined;
      return snapshot;
    } catch { throw createError({ statusCode: 502, data: { message: 'Не удалось обновить полную XML-выгрузку CRM. Предыдущая сохранённая выгрузка не заменена. Повторите обновление.' } }); }
    finally { await unlink(temporary).catch(() => {}); refreshing.delete(key); }
  })();
  refreshing.set(key, promise);
  return promise;
}

export async function getRf39Snapshot(source: string, path: string, refresh: boolean | 'saved' | 'refresh' = false): Promise<Rf39Snapshot> {
  let url: string;
  try { url = rf39FeedUrl(source); }
  catch { throw createError({ statusCode: 503, data: { message: 'XML-выгрузка CRM не настроена. Укажите адрес feed.rf39.ru в настройках.' } }); }
  if (!path) throw createError({ statusCode: 503, data: { message: 'Хранилище выгрузки CRM не настроено на сервере.' } });
  const filePath = resolve(path), sourceHash = createHash('sha256').update(url).digest('hex');
  if (!refresh || refresh === 'saved') {
    let snapshot;
    try { snapshot = await readSnapshot(filePath, sourceHash); }
    catch { throw createError({ statusCode: 502, data: { message: 'Не удалось прочитать сохранённую выгрузку CRM. Нажмите «Обновить из CRM».' } }); }
    if (snapshot) return snapshot;
    if (refresh === 'saved') throw createError({ statusCode: 503, data: { message: 'Сохранённая XML-выгрузка CRM для этого адреса не найдена. Сначала обновите выгрузку.' } });
  }
  return refreshSnapshot(filePath, url, sourceHash);
}
