// Tekent de app-iconen zonder externe pakketten: `npm run icons`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const STOPS = [[76, 29, 149], [109, 40, 217], [232, 70, 124], [255, 122, 89]];

function verloop(t) {
  const p = Math.min(0.9999, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.floor(p);
  return STOPS[i].map((c, k) => c + (STOPS[i + 1][k] - c) * (p - i));
}

function inAfgerondVlak(x, y, x0, y0, x1, y1, r) {
  const dx = Math.max(x0 + r - x, x - (x1 - r), 0);
  const dy = Math.max(y0 + r - y, y - (y1 - r), 0);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && dx * dx + dy * dy <= r * r;
}

// Drie stijgende staven; `schaal` houdt ze binnen de veilige zone van maskable iconen.
function isStaaf(x, y, schaal) {
  const u = (x - 0.5) / schaal + 0.5;
  const v = (y - 0.5) / schaal + 0.5;
  return [[0.2, 0.58], [0.42, 0.4], [0.64, 0.2]]
    .some(([links, top]) => inAfgerondVlak(u, v, links, top, links + 0.16, 0.8, 0.05));
}

function pixel(x, y, afgerond, schaal) {
  if (afgerond && !inAfgerondVlak(x, y, 0, 0, 1, 1, 0.22)) return [0, 0, 0, 0];
  if (isStaaf(x, y, schaal)) return [255, 255, 255, 255];
  return [...verloop((x + (1 - y)) / 2), 255];
}

function tekenIcoon(grootte, afgerond, schaal) {
  const stappen = 3;
  const regels = Buffer.alloc((grootte * 4 + 1) * grootte);
  for (let y = 0; y < grootte; y += 1) {
    const rij = y * (grootte * 4 + 1);
    for (let x = 0; x < grootte; x += 1) {
      const som = [0, 0, 0, 0];
      for (let sy = 0; sy < stappen; sy += 1) {
        for (let sx = 0; sx < stappen; sx += 1) {
          const [r, g, b, a] = pixel((x + (sx + 0.5) / stappen) / grootte, (y + (sy + 0.5) / stappen) / grootte, afgerond, schaal);
          som[0] += r * a;
          som[1] += g * a;
          som[2] += b * a;
          som[3] += a;
        }
      }
      const o = rij + 1 + x * 4;
      for (let k = 0; k < 3; k += 1) regels[o + k] = som[3] ? Math.round(som[k] / som[3]) : 0;
      regels[o + 3] = Math.round(som[3] / (stappen * stappen));
    }
  }
  return regels;
}

function chunk(type, data) {
  const lengte = Buffer.alloc(4);
  lengte.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([lengte, body, crc]);
}

function png(grootte, regels) {
  const kop = Buffer.alloc(13);
  kop.writeUInt32BE(grootte, 0);
  kop.writeUInt32BE(grootte, 4);
  kop[8] = 8;
  kop[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', kop),
    chunk('IDAT', deflateSync(regels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-192.png', png(192, tekenIcoon(192, true, 1)));
writeFileSync('icons/icon-512.png', png(512, tekenIcoon(512, true, 1)));
writeFileSync('icons/icon-maskable-512.png', png(512, tekenIcoon(512, false, 0.72)));
