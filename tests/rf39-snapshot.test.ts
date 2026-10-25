import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { getRf39Snapshot } from '../server/utils/rf39-snapshot';

const object = (id: number) => ({ id, title: `Объект ${id}`, type: 'Квартиры - вторичное жильё', deal_type: 'sale',
  params: { area: { value: '42 м²' } }, contact: { phone: 'PRIVATE_PHONE' }, agent: { email: 'PRIVATE_EMAIL' },
  token: 'PRIVATE_TOKEN', url: 'https://crm.rf39.ru/private?token=PRIVATE_TOKEN' });
const response = (items: unknown[]) => new Response(JSON.stringify({ code: 200, data: items }));
async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'newh-rf39-snapshot-'));
  t.after(async () => {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !basename(dir).startsWith('newh-rf39-snapshot-')) throw new Error('Unsafe cleanup path');
    await rm(dir, { recursive: true, force: true });
  });
  return join(dir, 'snapshot.json');
}

test('first load saves all pages and later requests reuse parsed safe data, including after a process restart', async t => {
  const path = await temporary(t);
  const offsets: number[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const offset = JSON.parse((init.body as URLSearchParams).get('params')!).offset;
    offsets.push(offset);
    return response(offset === 0 ? Array.from({ length: 100 }, (_, index) => object(index + 1)) : [object(101)]);
  });
  const first = await getRf39Snapshot('PRIVATE_TOKEN', path);
  assert.equal(first.items.length, 101);
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(new Date(first.snapshotDate).toISOString(), first.snapshotDate);
  const saved = await readFile(path, 'utf8');
  assert.doesNotMatch(saved, /PRIVATE_TOKEN|PRIVATE_PHONE|PRIVATE_EMAIL|"contact"|"agent"/);
  assert.equal(JSON.parse(saved).tokenHash, createHash('sha256').update('PRIVATE_TOKEN').digest('hex'));
  assert.deepEqual(await getRf39Snapshot('PRIVATE_TOKEN', path), first);
  const freshModule = new URL('../server/utils/rf39-snapshot.ts', import.meta.url);
  freshModule.searchParams.set('restart', String(Date.now()));
  const restarted = await import(freshModule.href);
  assert.deepEqual(await restarted.getRf39Snapshot('PRIVATE_TOKEN', path), first);
  assert.deepEqual(offsets, [0, 100]);
});

test('concurrent refreshes share one complete download and readers keep the last good snapshot until replacement', async t => {
  const path = await temporary(t);
  t.mock.method(globalThis, 'fetch', async () => response([object(1)]));
  const old = await getRf39Snapshot('token', path);
  let complete!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  const beginning = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; started(); await gate; return response([object(2)]); });
  const first = getRf39Snapshot('token', path, true);
  await beginning;
  const second = getRf39Snapshot('token', path, true);
  assert.deepEqual(await getRf39Snapshot('token', path), old);
  complete();
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0]!.items[0]!.id, 2);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).items, results[0]!.items);
  assert.deepEqual(await getRf39Snapshot('token', path), results[0]);
  assert.deepEqual(await readdir(resolve(path, '..')), ['snapshot.json']);
});

test('explicit saved mode never downloads when the snapshot is absent or belongs to another account', async t => {
  const path = await temporary(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response([object(1)]); });
  await assert.rejects(getRf39Snapshot('ACCOUNT_A', path, 'saved'), { statusCode: 503 });
  assert.equal(calls, 0);
  const snapshot = await getRf39Snapshot('ACCOUNT_A', path);
  assert.equal(calls, 1);
  assert.deepEqual(await getRf39Snapshot('ACCOUNT_A', path, 'saved'), snapshot);
  await assert.rejects(getRf39Snapshot('ACCOUNT_B', path, 'saved'), { statusCode: 503 });
  assert.equal(calls, 1);
  assert.deepEqual(await getRf39Snapshot('ACCOUNT_A', path, 'saved'), snapshot);
});

test('a failed later page never replaces or deletes the complete saved snapshot', async t => {
  const path = await temporary(t);
  t.mock.method(globalThis, 'fetch', async () => response([object(1)]));
  const old = await getRf39Snapshot('PRIVATE_TOKEN', path);
  const bytes = await readFile(path);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return response(Array.from({ length: 100 }, (_, index) => object(index + 2)));
    throw new Error('PRIVATE_TOKEN PRIVATE_PHONE upstream failure');
  });
  await assert.rejects(getRf39Snapshot('PRIVATE_TOKEN', path, true), error => {
    assert.equal((error as { statusCode: number }).statusCode, 502);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_TOKEN|PRIVATE_PHONE/);
    return true;
  });
  assert.equal(calls, 2);
  assert.deepEqual(await readFile(path), bytes);
  assert.deepEqual(await getRf39Snapshot('PRIVATE_TOKEN', path), old);
  assert.equal(calls, 2);
});

test('corruption produces a private error and explicit refresh can replace it', async t => {
  const path = await temporary(t);
  await writeFile(path, 'PRIVATE_TOKEN {broken json');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response([object(3)]); });
  await assert.rejects(getRf39Snapshot('token', path), error => {
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_TOKEN|broken json|snapshot\.json/);
    return true;
  });
  assert.equal(calls, 0);
  assert.equal((await getRf39Snapshot('token', path, true)).items[0]!.id, 3);
  assert.equal(calls, 1);
});

test('a different token never receives the previous account snapshot and preserves it if its first download fails', async t => {
  const path = await temporary(t);
  t.mock.method(globalThis, 'fetch', async () => response([object(1)]));
  await getRf39Snapshot('ACCOUNT_A', path);
  const first = await readFile(path);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('ACCOUNT_B'); });
  await assert.rejects(getRf39Snapshot('ACCOUNT_B', path));
  assert.deepEqual(await readFile(path), first);
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal((init.body as URLSearchParams).get('token'), 'ACCOUNT_B');
    return response([object(2)]);
  });
  const second = await getRf39Snapshot('ACCOUNT_B', path);
  assert.deepEqual(second.items.map(item => item.id), [2]);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.tokenHash, createHash('sha256').update('ACCOUNT_B').digest('hex'));
  assert.doesNotMatch(JSON.stringify(saved), /ACCOUNT_A|ACCOUNT_B/);
});

test('repeated pages cannot produce a partial snapshot or an endless refresh', async t => {
  const path = await temporary(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(Array.from({ length: 100 }, (_, index) => object(index + 1))); });
  await assert.rejects(getRf39Snapshot('token', path));
  assert.equal(calls, 2);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  assert.deepEqual(await readdir(resolve(path, '..')), []);
});

test('saved snapshot sizes and global IDs are validated before serving data', async t => {
  const path = await temporary(t);
  const file = await open(path, 'w');
  try { await file.truncate(128 * 1024 * 1024 + 1); } finally { await file.close(); }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch automatically after corruption'); });
  await assert.rejects(getRf39Snapshot('token', path), { statusCode: 502 });
  await writeFile(path, JSON.stringify({ version: 1, tokenHash: createHash('sha256').update('token').digest('hex'),
    snapshotDate: new Date().toISOString(), items: [...Array.from({ length: 100 }, (_, index) => object(index + 1)), object(1)] }));
  await assert.rejects(getRf39Snapshot('token', path), { statusCode: 502 });
  await assert.rejects(getRf39Snapshot('', path), { statusCode: 503 });
});
