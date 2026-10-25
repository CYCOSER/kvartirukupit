import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { convertUploadedImage, editImage, isFloorPlanImage, prepareFloorPlanImage } from '../server/utils/image';
import { rotateImageHue } from '../shared/image-edit';

test('Floor plans shift the colour spectrum to blue while preserving neutral pixels and contrast', async () => {
  const source = Buffer.from([255, 255, 255, 0, 0, 0, 36, 36, 36, 255, 209, 97]);
  const png = await sharp(source, { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer();
  const converted = await convertUploadedImage(png, 'image/png', { floorPlan: true });
  const { data, info } = await sharp(converted).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 4);
  assert.equal(info.height, 1);
  assert.deepEqual([...data.subarray(0, 3)], [255, 255, 255]);
  assert.deepEqual([...data.subarray(3, 9)], [0, 0, 0, 36, 36, 36]);
  assert.ok(data[11]! > data[10]! && data[10]! > data[9]!, 'Yellow accents become blue');
  assert.equal(Math.min(...data.subarray(9, 12)), 97);
  assert.equal(Math.max(...data.subarray(9, 12)), 255);
});

test('Photo uploads and plans preserve transparency without lossy compression', async () => {
  const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 50, b: 10, alpha: 0.5 } } }).png().toBuffer();
  const photo = await convertUploadedImage(png, 'image/png');
  assert.deepEqual(await sharp(photo).raw().toBuffer(), await sharp(png).raw().toBuffer());
  const transparent = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#0000' } }).png().toBuffer();
  const plan = await convertUploadedImage(transparent, 'image/png', { floorPlan: true });
  assert.deepEqual([...await sharp(plan).raw().toBuffer()], [0, 0, 0, 0]);
});

test('Photos keep their original resolution and pixels through upload and repeated editing', async () => {
  const width = 2101, height = 1503;
  const pixels = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < height; y++) {
    const index = (y * width + 97) * 3;
    pixels[index] = y % 256;
    pixels[index + 1] = (y + 83) % 256;
    pixels[index + 2] = (y + 167) % 256;
  }
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const uploaded = await convertUploadedImage(png, 'image/png');
  const edited = await editImage(await editImage(uploaded, { hueShift: 0, crop: null }));
  const output = await sharp(edited).raw().toBuffer({ resolveWithObject: true });
  assert.equal(output.info.width, width);
  assert.equal(output.info.height, height);
  assert.deepEqual(output.data, pixels);
});

test('Editing crops source pixels and rotates hue exactly like the preview, preserving alpha', async () => {
  const pixels = Buffer.from([10, 20, 30, 255, 40, 60, 80, 128, 200, 100, 50, 255, 20, 40, 60, 0]);
  const png = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  const edited = await editImage(png, {
    crop: { left: 1, top: 0, width: 1, height: 2 }, hueShift: 120,
  });
  const { data, info } = await sharp(edited).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1);
  assert.equal(info.height, 2);
  assert.deepEqual([...data], [80, 40, 60, 128, 60, 20, 40, 0]);
  const preview = new Uint8ClampedArray([40, 60, 80, 128, 20, 40, 60, 0]);
  rotateImageHue(preview, 4, 120);
  assert.deepEqual([...data], [...preview]);
});

test('Hue shifts suppress faint coloured edge noise without blurring dark contours or strong colours', async () => {
  const pixels = Buffer.from([
    0, 0, 0, 255, 36, 36, 36, 128,
    255, 254, 249, 255, 249, 251, 255, 64,
    255, 251, 243, 255, 255, 209, 97, 255,
  ]);
  const png = await sharp(pixels, { raw: { width: 6, height: 1, channels: 4 } }).png().toBuffer();
  const unchanged = Buffer.from(pixels);
  rotateImageHue(unchanged, 4, 0);
  assert.deepEqual(unchanged, pixels);
  const shifted = new Uint8ClampedArray(pixels);
  rotateImageHue(shifted, 4, 180);
  assert.deepEqual([...shifted.subarray(0, 8)], [...pixels.subarray(0, 8)]);
  for (const index of [8, 12]) {
    assert.equal(shifted[index], shifted[index + 1]);
    assert.equal(shifted[index], shifted[index + 2]);
    assert.equal(shifted[index + 3], pixels[index + 3]);
  }
  const transition = [...shifted.subarray(16, 19)];
  assert.ok(Math.max(...transition) - Math.min(...transition) < 12);
  assert.deepEqual([...shifted.subarray(20, 24)], [97, 143, 255, 255]);
  const saved = await sharp(await editImage(png, { hueShift: 180 })).raw().toBuffer();
  assert.deepEqual([...saved], [...shifted], 'Preview and saved pixels use the same noise suppression');
});

test('Crops use the displayed orientation and reject out-of-bounds or invalid edits', async () => {
  const png = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#fedcba' } })
    .withMetadata({ orientation: 6 }).png().toBuffer();
  const edited = await editImage(png, { crop: { left: 0, top: 2, width: 2, height: 2 } });
  const info = await sharp(edited).metadata();
  assert.equal(info.width, 2);
  assert.equal(info.height, 2);
  for (const crop of [
    { left: -1, top: 0, width: 1, height: 1 }, { left: 0, top: 0, width: 0, height: 1 },
    { left: 0.5, top: 0, width: 1, height: 1 }, { left: 0, top: 0, width: 3, height: 2 },
    { left: 0, top: 0, width: 1, height: 5 },
  ]) await assert.rejects(editImage(png, { crop }), /Invalid image or image edits/);
  for (const hueShift of [-181, 181, 0.5, NaN, Infinity])
    await assert.rejects(editImage(png, { hueShift }), /Invalid image or image edits/);
  await assert.rejects(editImage(Buffer.from('invalid')), /Invalid image/);
});

test('Saturated plan colours receive the same hue rotation, preserving HSL lightness, saturation and alpha', async () => {
  const source = Buffer.from([
    240, 180, 30, 255, 240, 180, 30, 255, 240, 180, 30, 255,
    80, 160, 100, 128, 100, 80, 200, 255, 255, 255, 255, 128, 29, 29, 29, 0,
  ]);
  const png = await sharp(source, { raw: { width: 7, height: 1, channels: 4 } }).png().toBuffer();
  const data = await sharp(await convertUploadedImage(png, 'image/png', { floorPlan: true })).raw().toBuffer();
  const hue = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b), range = max - Math.min(r, g, b);
    return (60 * (max === r ? (g - b) / range : max === g ? (b - r) / range + 2 : (r - g) / range + 4) + 360) % 360;
  };
  const shifts: number[] = [];
  for (let i = 0; i < source.length; i += 4) {
    const before = source.subarray(i, i + 3), after = data.subarray(i, i + 3);
    assert.equal(data[i + 3], source[i + 3]);
    assert.equal(Math.min(...after), Math.min(...before));
    assert.equal(Math.max(...after), Math.max(...before));
    if (before[0] === before[1] && before[1] === before[2]) assert.deepEqual(after, before);
    else shifts.push((hue(after[0]!, after[1]!, after[2]!) - hue(before[0]!, before[1]!, before[2]!) + 360) % 360);
  }
  assert.ok(Math.max(...shifts) - Math.min(...shifts) < 1, 'A common hue shift must retain differences between colours');
  assert.ok(Math.abs(hue(data[0]!, data[1]!, data[2]!) - 215) < 1);
});

test('Automatic floor-plan edits report a reproducible slider value relative to the original', async () => {
  const pixels = Buffer.from([240, 180, 30, 255, 240, 180, 30, 255, 80, 160, 100, 128, 29, 29, 29, 0]);
  const png = await sharp(pixels, { raw: { width: 4, height: 1, channels: 4 } }).png().toBuffer();
  const { buffer, hueShift } = await prepareFloorPlanImage(png);
  assert.ok(Number.isInteger(hueShift) && hueShift >= -180 && hueShift <= 180);
  assert.deepEqual(await sharp(await editImage(png, { hueShift })).raw().toBuffer(), await sharp(buffer).raw().toBuffer());
});

test('Plans retain original resolution and every pixel of thin monochrome linework', async () => {
  const width = 2101, height = 1503;
  const pixels = Buffer.alloc(width * height * 3, 255);
  for (let y = 0; y < height; y++) pixels.fill(y % 2 ? 0 : 36, (y * width + 97) * 3, (y * width + 98) * 3);
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const converted = await convertUploadedImage(png, 'image/png', { floorPlan: true });
  const output = await sharp(converted).raw().toBuffer({ resolveWithObject: true });
  assert.equal(output.info.width, width);
  assert.equal(output.info.height, height);
  assert.deepEqual(output.data, pixels);
});

test('Image safety validation is retained for floor plans', async () => {
  await assert.rejects(convertUploadedImage(Buffer.from('not an image'), 'image/png', { floorPlan: true }), /Invalid image/);
  await assert.rejects(convertUploadedImage(Buffer.from('<svg/>'), 'image/svg+xml', { floorPlan: true }), /JPEG, PNG or WebP/);
  await assert.rejects(convertUploadedImage(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png', { floorPlan: true }), /up to 10 MB/);
});

test('Conservative plan detection requires white space, sharp contours and flat regions together', async () => {
  const pixels = Buffer.alloc(256 * 256 * 3, 255);
  for (let y = 20; y < 236; y++) for (let x = 20; x < 236; x++) {
    if (x < 25 || x > 230 || y < 25 || y > 230 || (x > 125 && x < 130) || (y > 125 && y < 130))
      pixels.fill(30, (y * 256 + x) * 3, (y * 256 + x) * 3 + 3);
  }
  const encode = (data: Buffer) => sharp(data, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
  assert.equal(await isFloorPlanImage(await encode(pixels)), true);
  assert.equal(await isFloorPlanImage(await encode(Buffer.alloc(pixels.length, 255))), false);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const index = (y * 256 + x) * 3;
    pixels[index] = x; pixels[index + 1] = y; pixels[index + 2] = Math.floor((x + y) / 2);
  }
  assert.equal(await isFloorPlanImage(await encode(pixels)), false);
  // A bright photograph-like gradient must not pass on its white background alone.
  for (let index = 0; index < pixels.length; index++) pixels[index] = index % 8 < 5 ? 255 : pixels[index]!;
  assert.equal(await isFloorPlanImage(await encode(pixels)), false);
  assert.equal(await isFloorPlanImage(Buffer.from('invalid')), false);
});
