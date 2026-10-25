export function rgbHue(r: number, g: number, b: number, max: number, chroma: number) {
  return (60 * (max === r ? (g - b) / chroma : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) + 360) % 360;
}

export function rotateImageHue(pixels: Uint8Array | Uint8ClampedArray, channels: number, shift: number) {
  if (!shift) return;
  // Suppress faint compression colour noise without blurring text or changing HSL lightness.
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), range = max - min;
    if (!range) continue;
    const h = ((rgbHue(r, g, b, max, range) + shift + 360) % 360) / 60;
    const chroma = range * Math.min(1, Math.max(0, (range - 8) / 16));
    const neutral = (max + min - chroma) / 2;
    const x = chroma * (1 - Math.abs(h % 2 - 1));
    let red = 0, green = 0, blue = 0;
    if (h < 1) { red = chroma; green = x; }
    else if (h < 2) { red = x; green = chroma; }
    else if (h < 3) { green = chroma; blue = x; }
    else if (h < 4) { green = x; blue = chroma; }
    else if (h < 5) { red = x; blue = chroma; }
    else { red = chroma; blue = x; }
    pixels[i] = Math.round(neutral + red);
    pixels[i + 1] = Math.round(neutral + green);
    pixels[i + 2] = Math.round(neutral + blue);
  }
}
