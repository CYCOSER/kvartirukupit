import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { samePhoto, type PhotoFingerprint } from '../server/utils/image-fingerprint';

test('real imported render variants match while different viewpoints, framing and night scenes remain separate', async () => {
  // These 64px RGB samples reproduce the remaining duplicates reported in the «Включи» gallery.
  const directory = new URL('./fixtures/photo-duplicates/', import.meta.url);
  const manifest: { file: string; group: string; width: number; height: number }[] =
    JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  const images: (typeof manifest[number] & PhotoFingerprint)[] = [];
  for (const sample of manifest) images.push({ ...sample,
    pixels: await sharp(fileURLToPath(new URL(sample.file, directory))).removeAlpha().raw().toBuffer() });
  for (const left of images) for (const right of images) {
    assert.equal(samePhoto(left, right), left.group === right.group, `${left.file} versus ${right.file}`);
  }
});
