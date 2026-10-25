import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createError } from 'h3';
import { z } from 'zod';
import { fetchRf39Objects } from './rf39';
import { parseRf39Response, type Rf39Object } from './rf39-data';

const MAX_ITEMS = 20000;
const MAX_BYTES = 128 * 1024 * 1024;
type Snapshot = { items: Rf39Object[]; snapshotDate: string };
let cached: { key: string; signature: string; snapshot: Snapshot } | undefined;
const refreshing = new Map<string, Promise<Snapshot>>();
const envelope = z.object({
  version: z.literal(1), tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotDate: z.string().datetime(), items: z.array(z.unknown()).max(MAX_ITEMS),
});

async function readSnapshot(path: string, tokenHash: string): Promise<Snapshot | null> {
  let file;
  try { file = await open(path, 'r'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Invalid snapshot size');
    const key = `${path}\0${tokenHash}`, signature = `${info.ino}\0${info.mtimeMs}\0${info.size}`;
    if (cached?.key === key && cached.signature === signature) return cached.snapshot;
    const bytes = await file.readFile();
    if (bytes.length > MAX_BYTES) throw new Error('Invalid snapshot size');
    const saved = envelope.parse(JSON.parse(bytes.toString('utf8')));
    if (saved.tokenHash !== tokenHash) return null;
    const items: Rf39Object[] = [];
    for (let offset = 0; offset < saved.items.length; offset += 100)
      items.push(...parseRf39Response({ code: 200, data: saved.items.slice(offset, offset + 100) }));
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate snapshot object');
    const snapshot = { items, snapshotDate: saved.snapshotDate };
    cached = { key, signature, snapshot };
    return snapshot;
  } finally { await file.close(); }
}

function refreshSnapshot(path: string, token: string, tokenHash: string) {
  const key = `${path}\0${tokenHash}`;
  const pending = refreshing.get(key);
  if (pending) return pending;
  const promise = (async (): Promise<Snapshot> => {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const items: Rf39Object[] = [], ids = new Set<number>();
      let size = 256;
      const started = Date.now();
      for (let offset = 0; offset <= MAX_ITEMS; offset += 100) {
        if (Date.now() - started > 5 * 60 * 1000) throw new Error('Refresh took too long');
        const page = await fetchRf39Objects(token, offset);
        size += Buffer.byteLength(JSON.stringify(page));
        if (size > MAX_BYTES || items.length + page.length > MAX_ITEMS) throw new Error('Snapshot exceeds limit');
        for (const item of page) {
          if (ids.has(item.id)) throw new Error('CRM repeated an object');
          ids.add(item.id); items.push(item);
        }
        if (page.length < 100) break;
      }
      const snapshot = { items, snapshotDate: new Date().toISOString() };
      const data = JSON.stringify({ version: 1, tokenHash, ...snapshot });
      if (Buffer.byteLength(data) > MAX_BYTES) throw new Error('Snapshot exceeds limit');
      await mkdir(dirname(path), { recursive: true });
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(data); await file.sync(); }
      finally { await file.close(); }
      // Publish only a complete validated download; failures leave the previous file untouched.
      await rename(temporary, path);
      cached = undefined;
      return snapshot;
    } catch {
      throw createError({ statusCode: 502, data: { message: 'Не удалось обновить полную выгрузку CRM. Предыдущая сохранённая выгрузка не заменена. Повторите обновление.' } });
    } finally {
      await unlink(temporary).catch(() => {});
      refreshing.delete(key);
    }
  })();
  refreshing.set(key, promise);
  return promise;
}

export async function getRf39Snapshot(token: string, path: string, refresh: boolean | 'saved' = false): Promise<Snapshot> {
  if (!token) throw createError({ statusCode: 503, data: { message: 'Подключение CRM не настроено. Добавьте NUXT_RF39_TOKEN на сервере.' } });
  if (!path) throw createError({ statusCode: 503, data: { message: 'Хранилище выгрузки CRM не настроено на сервере.' } });
  const filePath = resolve(path), tokenHash = createHash('sha256').update(token).digest('hex');
  if (!refresh || refresh === 'saved') {
    let snapshot;
    try { snapshot = await readSnapshot(filePath, tokenHash); }
    catch { throw createError({ statusCode: 502, data: { message: 'Не удалось прочитать сохранённую выгрузку CRM. Нажмите «Обновить из CRM».' } }); }
    if (snapshot) return snapshot;
    if (refresh === 'saved') throw createError({ statusCode: 503, data: { message: 'Сохранённая выгрузка CRM не найдена. Сначала обновите выгрузку из CRM.' } });
  }
  return refreshSnapshot(filePath, token, tokenHash);
}
