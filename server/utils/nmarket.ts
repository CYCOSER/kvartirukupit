import { createError } from 'h3';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseNmarketFeed, parseNmarketSnapshot, type NmarketObject } from './nmarket-data';

let cached: { key: string; expires: number; items: NmarketObject[] } | undefined;
let pending: { key: string; promise: Promise<NmarketObject[]> } | undefined;
type SavedSnapshot = { items: NmarketObject[]; snapshotDate: string };
let saved: { key: string; snapshot: SavedSnapshot } | undefined;
let savedPending: { key: string; promise: Promise<SavedSnapshot> } | undefined;

export async function fetchNmarketSnapshot(path: string): Promise<SavedSnapshot> {
  const info = path ? await stat(path).catch(() => null) : null;
  if (!info?.isFile()) throw createError({ statusCode: 503, data: { message: 'Сохранённая выгрузка НМаркет не настроена на сервере.' } });
  if (info.size > 128 * 1024 * 1024) throw createError({ statusCode: 502, data: { message: 'Сохранённая выгрузка НМаркет превышает 128 МБ.' } });
  const key = `${path}\0${info.mtimeMs}\0${info.size}`;
  if (saved?.key === key) return saved.snapshot;
  if (savedPending?.key === key) return savedPending.promise;
  const promise = (async () => {
    try {
      const parsed = await parseNmarketSnapshot(createReadStream(path));
      const after = await stat(path);
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('Snapshot changed during reading');
      const snapshot = { items: parsed.items, snapshotDate: parsed.generationDate || info.mtime.toISOString() };
      saved = { key, snapshot };
      return snapshot;
    } catch {
      throw createError({ statusCode: 502, data: { message: 'Не удалось прочитать сохранённую выгрузку НМаркет. Проверьте целостность XML на сервере.' } });
    }
  })();
  savedPending = { key, promise };
  try { return await promise; }
  finally { if (savedPending?.promise === promise) savedPending = undefined; }
}

export function nmarketFeedUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'ecatalog-service.nmarket.pro' ||
      url.port || url.username || url.password || url.hash) throw new Error('Invalid NMarket source');
  return url.href;
}

async function download(source: string, path: string) {
  const temporary = path ? `${path}.${randomUUID()}.tmp` : '';
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const response = await fetch(nmarketFeedUrl(source), { redirect: 'error', signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 128 * 1024 * 1024) throw new Error('Invalid feed response');
    const reader = response.body.getReader();
    async function* chunks() {
      try {
        if (temporary) {
          await mkdir(dirname(path), { recursive: true });
          file = await open(temporary, 'wx', 0o600);
        }
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield value;
          await file?.writeFile(value);
        }
      } finally { await reader.cancel(); }
    }
    const items = await parseNmarketFeed(chunks());
    if (file) {
      await file.sync();
      await file.close();
      file = undefined;
      // Replace the saved XML only after the complete download passes validation.
      await rename(temporary, path);
      saved = undefined;
    }
    return items;
  } catch {
    // The source URL and upstream errors may contain private export credentials.
    throw createError({ statusCode: 502, data: { message: 'Не удалось загрузить и сохранить полную выгрузку НМаркет. Предыдущая сохранённая выгрузка не заменена. Повторите запрос.' } });
  } finally {
    await file?.close().catch(() => {});
    if (temporary) await unlink(temporary).catch(() => {});
  }
}

export async function fetchNmarketObjects(source: string, snapshotPath = '', refresh = false) {
  if (!source) throw createError({ statusCode: 503, data: { message: 'Подключение НМаркет не настроено. Добавьте NUXT_NMARKET_FEED_URL на сервере.' } });
  const path = snapshotPath ? resolve(snapshotPath) : '', key = `${source}\0${path}`;
  if (!refresh && cached?.key === key && cached.expires > Date.now()) return cached.items;
  if (pending?.key === key) return pending.promise;
  const promise = download(source, path).then(items => {
    cached = { key, items, expires: Date.now() + 10 * 60 * 1000 };
    return items;
  });
  pending = { key, promise };
  try { return await promise; }
  finally { if (pending?.promise === promise) pending = undefined; }
}
