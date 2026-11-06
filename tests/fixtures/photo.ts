import sharp from 'sharp';

export async function detailedPhoto(width = 640, height = 480) {
  const buildings = Array.from({ length: 8 }, (_, i) => {
    const x = 20 + i * 77, top = 130 + (i % 3) * 28;
    const windows = Array.from({ length: 24 }, (_, j) => `<rect x="${x + 7 + j % 4 * 15}" y="${top + 9 + Math.floor(j / 4) * 25}" width="8" height="14" fill="${j % 3 ? '#87b5c1' : '#d9b45b'}"/>`).join('');
    return `<rect x="${x}" y="${top}" width="69" height="245" fill="${['#b06441', '#788e9e', '#dbaf7a'][i % 3]}"/>${windows}`;
  }).join('');
  const trees = Array.from({ length: 12 }, (_, i) => `<path d="M${i * 57 + 8} 460 l14 -95 l14 95" fill="${i % 2 ? '#246547' : '#458757'}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#287cbf"/><stop offset="1" stop-color="#b6d8dc"/></linearGradient></defs><rect width="640" height="480" fill="url(#sky)"/><ellipse cx="180" cy="65" rx="100" ry="20" fill="#e2eaf0"/><ellipse cx="510" cy="90" rx="70" ry="13" fill="#b4c4d1"/>${buildings}<path d="M0 410 L640 365 L640 480 L0 480" fill="#737077"/>${trees}<path d="M0 463 L640 418" stroke="#dbd1a8" stroke-width="5"/></svg>`;
  return sharp(Buffer.from(svg)).resize(width, height).png().toBuffer();
}
