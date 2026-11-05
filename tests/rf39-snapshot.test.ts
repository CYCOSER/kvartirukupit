import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { getRf39Snapshot } from '../server/utils/rf39-snapshot';
import { rf39Offer, rf39Xml } from './fixtures/rf39-feed';

const source = 'https://feed.rf39.ru/201.xml';
const response = (...ids: number[]) => new Response(rf39Xml(...ids.map(id => rf39Offer(id, '<sales-agent><phone>PRIVATE_PHONE</phone></sales-agent>'))));
async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'newh-rf39-snapshot-'));
  t.after(async () => {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !basename(dir).startsWith('newh-rf39-snapshot-')) throw new Error('Unsafe cleanup path');
    await rm(dir, { recursive: true, force: true });
  });
  return join(dir, 'snapshot.json');
}

test('XML snapshot persists complete safe data and serves it after restart', async t => {
  const path = await temporary(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(...Array.from({ length: 101 }, (_, index) => index + 1)); });
  const first = await getRf39Snapshot(source, path);
  assert.equal(first.items.length, 101);
  assert.equal(calls, 1);
  const saved = await readFile(path, 'utf8');
  assert.doesNotMatch(saved, /PRIVATE_PHONE|sales-agent/);
  assert.equal(JSON.parse(saved).version, 2);
  assert.equal(JSON.parse(saved).sourceHash, createHash('sha256').update(source).digest('hex'));
  assert.deepEqual(await getRf39Snapshot(source, path, 'saved'), first);
  const module = new URL('../server/utils/rf39-snapshot.ts', import.meta.url);
  module.searchParams.set('restart', String(Date.now()));
  assert.deepEqual(await (await import(module.href)).getRf39Snapshot(source, path), first);
  assert.equal(calls, 1);
});

test('concurrent refresh shares one download and readers keep previous complete snapshot', async t => {
  const path = await temporary(t);
  t.mock.method(globalThis, 'fetch', async () => response(1));
  const old = await getRf39Snapshot(source, path);
  let complete!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  const beginning = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; started(); await gate; return response(2); });
  const first = getRf39Snapshot(source, path, 'refresh');
  await beginning;
  const second = getRf39Snapshot(source, path, true);
  assert.deepEqual(await getRf39Snapshot(source, path), old);
  complete();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0]!.presentIds, [2]);
  assert.deepEqual(await readdir(resolve(path, '..')), ['snapshot.json']);
});

test('saved mode refuses another source and legacy API snapshots without downloading', async t => {
  const path = await temporary(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(1); });
  await assert.rejects(getRf39Snapshot(source, path, 'saved'), { statusCode: 503 });
  const snapshot = await getRf39Snapshot(source, path);
  await assert.rejects(getRf39Snapshot('https://feed.rf39.ru/202.xml', path, 'saved'), { statusCode: 503 });
  assert.deepEqual(await getRf39Snapshot(source, path, 'saved'), snapshot);
  await writeFile(path, JSON.stringify({ version: 1, tokenHash: 'a'.repeat(64), items: [], snapshotDate: snapshot.snapshotDate }));
  await assert.rejects(getRf39Snapshot(source, path, 'saved'), { statusCode: 503 });
  assert.equal(calls, 1);
  await getRf39Snapshot(source, path);
  assert.equal(calls, 2);
});

test('failed, truncated, empty and duplicate feeds never overwrite saved source', async t => {
  const path = await temporary(t);
  t.mock.method(globalThis, 'fetch', async () => response(1));
  await getRf39Snapshot(source, path);
  const original = await readFile(path);
  for (const xml of ['PRIVATE_CONTACT', rf39Xml(), rf39Xml(rf39Offer(2)).slice(0, -5), rf39Xml(rf39Offer(2), rf39Offer(2))]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(xml));
    await assert.rejects(getRf39Snapshot(source, path, true), error => {
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_CONTACT/);
      return (error as any).statusCode === 502;
    });
    assert.deepEqual(await readFile(path), original);
  }
  assert.deepEqual(await readdir(resolve(path, '..')), ['snapshot.json']);
});

test('corrupt or oversized snapshots fail closed and explicit refresh repairs them', async t => {
  const path = await temporary(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(3); });
  await writeFile(path, 'PRIVATE_CONTACT invalid JSON');
  await assert.rejects(getRf39Snapshot(source, path), { statusCode: 502 });
  assert.equal(calls, 0);
  assert.deepEqual((await getRf39Snapshot(source, path, true)).presentIds, [3]);
  const file = await open(path, 'w');
  try { await file.truncate(128 * 1024 * 1024 + 1); } finally { await file.close(); }
  await assert.rejects(getRf39Snapshot(source, path), { statusCode: 502 });
  assert.equal(calls, 1);
});

test('saved snapshot validates canonical identity sets and source errors', async t => {
  const path = await temporary(t);
  t.mock.method(globalThis, 'fetch', async () => response(1));
  await getRf39Snapshot(source, path);
  const original = JSON.parse(await readFile(path, 'utf8'));
  for (const change of [{ presentIds: [1, 1] }, { presentIds: [2] }, { items: [...original.items, ...original.items] },
    { errors: [{ id: null, message: 'Unknown identity' }], authoritative: true }]) {
    await writeFile(path, JSON.stringify({ ...original, ...change }));
    await assert.rejects(getRf39Snapshot(source, path), { statusCode: 502 });
  }
});
