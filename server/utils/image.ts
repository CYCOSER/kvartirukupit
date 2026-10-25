import sharp from 'sharp';
import { createError } from 'h3';
import { rgbHue, rotateImageHue } from '../../shared/image-edit';

export async function isFloorPlanImage(data: Buffer) {
  if (data.length > 10 * 1024 * 1024) return false;
  try {
    const { data: pixels, info } = await sharp(data, { limitInputPixels: 40000000 })
      .rotate().resize(384, 384, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#fff' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    if (info.width < 96 || info.height < 96) return false;
    let white = 0, neutral = 0, dark = 0, flat = 0, edge = 0, gradient = 0, pairs = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const index = (y * info.width + x) * 3;
      const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!;
      const high = Math.max(r, g, b), low = Math.min(r, g, b);
      if (low >= 240) white++;
      if (high - low <= 24) neutral++;
      if (high < 160 && high - low < 28) dark++;
      for (const next of [x + 1 < info.width ? index + 3 : -1, y + 1 < info.height ? index + info.width * 3 : -1]) {
        if (next < 0) continue;
        const delta = Math.max(Math.abs(r - pixels[next]!), Math.abs(g - pixels[next + 1]!), Math.abs(b - pixels[next + 2]!));
        pairs++;
        if (delta <= 6) flat++;
        if (delta >= 65) edge++;
        if (delta > 8 && delta < 60) gradient++;
      }
    }
    const count = info.width * info.height;
    // shortcut: RF39 has mixed untyped galleries; uncertain drawings need the manual plan action.
    return white / count >= 0.58 && neutral / count >= 0.72 && dark / count >= 0.005 &&
      flat / pairs >= 0.74 && edge / pairs >= 0.008 && edge / pairs <= 0.16 && gradient / pairs <= 0.19;
  } catch { return false; }
}

function shiftPlanHue(pixels: Buffer, channels: number) {
  const weights = new Float64Array(36), hues = new Float64Array(36);
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
    const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
    if (chroma < 12) continue;
    const hue = rgbHue(r, g, b, max, chroma), bin = Math.floor(hue / 10);
    const weight = chroma * (channels === 4 ? pixels[i + 3]! : 255);
    weights[bin] += weight;
    hues[bin] += hue * weight;
  }
  const peak = weights.indexOf(Math.max(...weights));
  if (!weights[peak]) return 0;
  const shift = Math.round((215 - hues[peak]! / weights[peak]! + 540) % 360 - 180);
  rotateImageHue(pixels, channels, shift);
  return shift;
}

export type ImageEdits = {
  crop?: { left: number; top: number; width: number; height: number } | null;
  hueShift?: number;
};

export async function editImage(data: Buffer, { crop, hueShift = 0 }: ImageEdits = {}) {
  try {
    const image = sharp(data, { limitInputPixels: 40000000 });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format || '')) throw new Error('format');
    if (crop && (!Object.values(crop).every(Number.isInteger) ||
      crop.left < 0 || crop.top < 0 || crop.width < 1 || crop.height < 1 ||
      crop.left + crop.width > metadata.autoOrient.width || crop.top + crop.height > metadata.autoOrient.height))
      throw new Error('crop');
    if (!Number.isInteger(hueShift) || hueShift < -180 || hueShift > 180) throw new Error('hue');
    image.rotate().toColourspace('srgb');
    if (crop) image.extract(crop);
    if (!hueShift) return await image.webp({ lossless: true, exact: true }).toBuffer();
    const { data: pixels, info } = await image.raw().toBuffer({ resolveWithObject: true });
    rotateImageHue(pixels, info.channels, hueShift);
    return await sharp(pixels, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .webp({ lossless: true, exact: true }).toBuffer();
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid image or image edits' });
  }
}

export async function convertUploadedImage(data: Buffer, type = '', options: { floorPlan?: boolean } = {}) {
  if (
    data.length > 10 * 1024 * 1024 ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(type)
  )
    throw createError({
      statusCode: 400,
      statusMessage: 'JPEG, PNG or WebP up to 10 MB required',
    });

  return options.floorPlan ? (await prepareFloorPlanImage(data)).buffer : editImage(data);
}

export async function prepareFloorPlanImage(data: Buffer) {
  try {
    const metadata = await sharp(data, {
      limitInputPixels: 40000000,
    }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format || ''))
      throw new Error('format');
    const image = sharp(data, { limitInputPixels: 40000000 }).rotate();

    const { data: pixels, info } = await image.toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const hueShift = shiftPlanHue(pixels, info.channels);
    const buffer = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .webp({ lossless: true, exact: true }).toBuffer();
    return { buffer, hueShift };
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid image' });
  }
}
