// tools/make-icon.mjs — WHENDESK 앱 아이콘을 굽는다. 시리즈 브랜드 아이콘 "한 줄"(whenwork docs/08_브랜드.md D-B02)을 그대로 쓴다.
//
// 원본은 그림 파일이 아니라 아래 ICON — 64 단위 격자 위의 둥근 사각형 세 개다(먹색 틀 · 안개색 글 한 줄 · 라임 커서).
// 그리는 코드는 whenwork tools/make-icon.mjs(같은 작성자)에서 옮겼다: 도형을 크기마다 직접 그리고(가장자리는 거리로
// 안티에일리어싱), 48px 이하는 가장자리를 픽셀 격자에 맞춰 16px 트레이에서도 두 막대가 붙어 보이지 않는다.
// 여기서 굽는 것:
//   assets/icon.png            — 설치 파일·실행 파일 아이콘(1024, tools/installer.json)
//   assets/icons/brand.png     — 창 아이콘(1024, main/index.mjs iconFile)
//   assets/icons/tray-<n>.png  — 트레이(16·20·24·32 = 배율 1·1.25·1.5·2). 큰 그림을 줄이지 않고 크기마다 그린다(main trayIcon)
//   build/icons/brand.svg      — 미리보기용 벡터. 손으로 고치지 않는다.
// 실행: node tools/make-icon.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── 아이콘 정의 — 안개 + 라임 팔레트(renderer/tokens.css)
//   틀: 먹색 둥근 사각형 / 기호: 적어 둔 글 한 줄(안개색) + 깜박이는 커서(라임)
export const COLORS = { ink: '#151A21', fog: '#E8ECF0', lime: '#C6EE3A' };
export const ICON = {
  grid: 64,
  frame: { x: 3, y: 3, w: 58, h: 58, r: 14, color: COLORS.ink },
  glyph: [
    { x: 13, y: 29, w: 25, h: 6, r: 3, color: COLORS.fog }, // 글 한 줄
    { x: 43, y: 18, w: 7, h: 28, r: 3.5, color: COLORS.lime }, // 커서
  ],
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// 점(px,py)에서 둥근 사각형 가장자리까지의 거리(안쪽은 음수). 단위는 격자 단위.
function rrectDistance(px, py, { x, y, w, h, r }) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// 도형들을 size×size로 그린다. box는 격자에서 그릴 영역(정사각). 가장자리 덮임은 픽셀 중심에서
// 가장자리까지의 거리로 정한다 — 거리 0이면 반쯤 덮인 픽셀. 색 지정(color)이 있으면 모든 도형을
// 그 한 색으로 칠한다(트레이 Template).
export function render(shapes, size, { box = { x: 0, y: 0, side: ICON.grid }, color = null } = {}) {
  const out = Buffer.alloc(size * size * 4);
  const scale = box.side / size; // 격자 단위 / 픽셀
  const fills = shapes.map((s) => hex(color ?? s.color));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const gx = box.x + (px + 0.5) * scale;
      const gy = box.y + (py + 0.5) * scale;
      let r = 0, g = 0, b = 0, a = 0; // 미리 곱한 알파로 겹친다
      shapes.forEach((s, i) => {
        const cov = Math.min(1, Math.max(0, 0.5 - rrectDistance(gx, gy, s) / scale));
        if (!cov) return;
        const [cr, cg, cb] = fills[i];
        r = cr * cov + r * (1 - cov);
        g = cg * cov + g * (1 - cov);
        b = cb * cov + b * (1 - cov);
        a = cov + a * (1 - cov);
      });
      const d = (py * size + px) * 4;
      out[d] = a ? Math.round(r / a) : 0;
      out[d + 1] = a ? Math.round(g / a) : 0;
      out[d + 2] = a ? Math.round(b / a) : 0;
      out[d + 3] = Math.round(a * 255);
    }
  }
  return out;
}

// 작은 크기에서는 도형 가장자리를 픽셀 격자에 맞춘다. 16px에서 격자 1칸은 0.25px라, 맞추지 않으면
// 글 한 줄과 커서 사이 틈(5칸 = 1.25px)이 두 픽셀에 걸쳐 반투명으로 번져 두 막대가 한 덩어리로
// 붙어 보인다(테스트가 잡았다). 큰 크기는 그대로 둔다 — 반 픽셀 차이가 보이지 않는다.
export function snapToPixels(shapes, size, box = { x: 0, y: 0, side: ICON.grid }) {
  const k = size / box.side;
  const snapX = (v) => box.x + Math.round((v - box.x) * k) / k;
  const snapY = (v) => box.y + Math.round((v - box.y) * k) / k;
  return shapes.map((s) => {
    const x = snapX(s.x), y = snapY(s.y);
    const w = Math.max(1 / k, snapX(s.x + s.w) - x), h = Math.max(1 / k, snapY(s.y + s.h) - y);
    return { ...s, x, y, w, h, r: Math.min(s.r, w / 2, h / 2) };
  });
}

const SNAP_MAX = 48;

// 앱 아이콘 전체(틀 + 기호)
export function appIcon(size) {
  const shapes = [ICON.frame, ...ICON.glyph];
  return render(size <= SNAP_MAX ? snapToPixels(shapes, size) : shapes, size);
}

// 기호만 감싸는 정사각 영역 — 메뉴바 Template은 틀 없이 기호가 칸을 채워야 한다
export function glyphBox(pad = 1) {
  const x0 = Math.min(...ICON.glyph.map((s) => s.x));
  const y0 = Math.min(...ICON.glyph.map((s) => s.y));
  const x1 = Math.max(...ICON.glyph.map((s) => s.x + s.w));
  const y1 = Math.max(...ICON.glyph.map((s) => s.y + s.h));
  const side = Math.max(x1 - x0, y1 - y0) + pad * 2;
  return { x: (x0 + x1) / 2 - side / 2, y: (y0 + y1) / 2 - side / 2, side };
}

// macOS Template: 기호만, 검정 — OS가 다크/라이트에 맞춰 칠한다
export function templateGlyph(size) {
  const box = glyphBox();
  const shapes = size <= SNAP_MAX ? snapToPixels(ICON.glyph, size, box) : ICON.glyph;
  return render(shapes, size, { box, color: '#000000' });
}

export function iconSvg() {
  const rect = (s) => `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${s.color}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON.grid} ${ICON.grid}">` +
    `${[ICON.frame, ...ICON.glyph].map(rect).join('')}</svg>\n`;
}


export const TRAY_SIZES = [16, 20, 24, 32];

export function buildIcons() {
  const write = (file, size, px) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, encodePng(size, size, px)); };
  write(path.join(ROOT, 'assets', 'icon.png'), 1024, appIcon(1024));
  write(path.join(ROOT, 'assets', 'icons', 'brand.png'), 1024, appIcon(1024));
  for (const size of TRAY_SIZES) write(path.join(ROOT, 'assets', 'icons', `tray-${size}.png`), size, appIcon(size));
  fs.mkdirSync(path.join(ROOT, 'build', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'build', 'icons', 'brand.svg'), iconSvg());
  return { images: 2 + TRAY_SIZES.length };
}

if (process.argv[1] && process.argv[1].endsWith('make-icon.mjs')) {
  const info = buildIcons();
  console.log(`icons written to assets/ and build/icons/ (${info.images} images)`);
}
