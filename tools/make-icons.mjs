/**
 * PWA용 PNG 아이콘 생성기 (의존성 없음).
 * 실행: node tools/make-icons.mjs
 *
 * assets/icon.svg와 동일한 디자인(파란 배경 + 흰 핀)을 3x 슈퍼샘플링으로 래스터화한다.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..", "assets");

const BG = [0x1b, 0x64, 0xda];
const FG = [0xff, 0xff, 0xff];

/* ---------- PNG 인코딩 ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- 도형 판정 (0~1 정규 좌표) ---------- */

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** 위쪽 원 + 아래로 뾰족한 삼각형으로 이루어진 핀 */
function inPin(x, y) {
  const cx = 0.5;
  const cy = 0.42;
  const r = 0.2;
  if (inCircle(x, y, cx, cy, r)) return true;
  // 삼각형: (cx±r*0.78, cy+r*0.45) — (cx, 0.84)
  const top = cy + r * 0.45;
  if (y < top || y > 0.84) return false;
  const t = (y - top) / (0.84 - top);
  const halfWidth = r * 0.78 * (1 - t);
  return Math.abs(x - cx) <= halfWidth;
}

const inHole = (x, y) => inCircle(x, y, 0.5, 0.42, 0.082);

/** 둥근 모서리 정사각형 (maskable 대응 위해 전체를 배경으로 채움) */
function inRounded(x, y, radius = 0.22) {
  const dx = Math.min(x, 1 - x);
  const dy = Math.min(y, 1 - y);
  if (dx >= radius || dy >= radius) return true;
  return (radius - dx) ** 2 + (radius - dy) ** 2 <= radius * radius;
}

function renderIcon(size, { rounded }) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // 슈퍼샘플링 배수

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bg = 0;
      let fg = 0;
      let samples = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          samples += 1;
          if (rounded && !inRounded(x, y)) continue;
          bg += 1;
          if (inPin(x, y) && !inHole(x, y)) fg += 1;
        }
      }

      const alpha = bg / samples;
      const fgRatio = bg ? fg / bg : 0;
      const idx = (py * size + px) * 4;
      for (let c = 0; c < 3; c += 1) {
        rgba[idx + c] = Math.round(BG[c] * (1 - fgRatio) + FG[c] * fgRatio);
      }
      rgba[idx + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  // maskable 아이콘은 여백 없이 꽉 채워야 하므로 모서리를 자르지 않는다
  writeFileSync(resolve(OUT_DIR, `icon-${size}.png`), renderIcon(size, { rounded: false }));
  console.log(`assets/icon-${size}.png 생성`);
}
writeFileSync(resolve(OUT_DIR, "icon-apple-180.png"), renderIcon(180, { rounded: true }));
console.log("assets/icon-apple-180.png 생성");
