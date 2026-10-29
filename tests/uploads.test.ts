import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp, toWebHandler } from 'h3';
import uploads from '../server/routes/uploads/[...path].get';

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'newh-uploads-'));
  const previousDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  t.after(async () => {
    if (previousDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  const app = createApp();
  app.use(uploads);
  const handle = toWebHandler(app);
  const request = (path: string) => handle(new Request(`http://localhost${path}`));
  return { dir, request };
}

test('GET /uploads/<file> returns the stored image with image/webp content-type', async t => {
  const { dir, request } = await fixture(t);
  const file = randomUUID() + '.webp';
  const content = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  await writeFile(join(dir, file), content);
  const response = await request('/uploads/' + file);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...content]);
});

test('GET /uploads/<missing> returns 404', async t => {
  const { request } = await fixture(t);
  const response = await request('/uploads/' + randomUUID() + '.webp');
  assert.equal(response.status, 404);
});

test('GET rejects directory traversal and invalid paths', async t => {
  const { request } = await fixture(t);
  for (const path of [
    '/uploads/../private.webp',
    '/uploads/./private.webp',
    '/uploads/a/b.webp',
    '/uploads/private.txt',
    '/uploads/not-a-uuid.webp',
    '/uploads/' + randomUUID() + '.webp/',
  ]) {
    const response = await request(path);
    assert.equal(response.status, 400, path + ' should be 400');
  }
});
