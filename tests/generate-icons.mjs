import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = table[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, sum]);
}

function makeIcon(size, path) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.22;
  const cream = [247, 245, 239, 255];
  const green = [23, 107, 82, 255];
  const distanceToSegment = (x, y, x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      const cornerX = Math.max(radius - x, 0, x - (size - radius));
      const cornerY = Math.max(radius - y, 0, y - (size - radius));
      const inside = cornerX * cornerX + cornerY * cornerY <= radius * radius;
      let color = inside ? green : [0, 0, 0, 0];
      const stroke = size * 0.055;
      const stem = distanceToSegment(nx, ny, .49, .82, .62, .28) < stroke / size;
      const leftLeaf = ((nx - .39) / .19) ** 2 + ((ny - .5) / .12) ** 2 < 1 && nx < .53;
      const rightLeaf = ((nx - .66) / .18) ** 2 + ((ny - .37) / .11) ** 2 < 1 && nx > .52;
      if (inside && (stem || leftLeaf || rightLeaf)) color = cream;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      raw.set(color, offset);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  writeFileSync(path, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

makeIcon(192, new URL('../icons/icon-192.png', import.meta.url));
makeIcon(512, new URL('../icons/icon-512.png', import.meta.url));
console.log('Iconos generados.');
