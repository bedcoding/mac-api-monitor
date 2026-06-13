// ============================================================================
//  ⚠️ Windows / Linux 전용 모듈 — macOS 에서는 호출되지 않음
// ============================================================================
//  macOS 는 tray.setTitle 로 메뉴바에 emoji+숫자를 직접 표시한다(setTitle 은 macOS 전용).
//  Windows/Linux 는 setTitle 이 동작하지 않으므로, 여기서 상태색 원 + 개수 숫자를
//  nativeImage 에 직접 그려 트레이 아이콘으로 보여준다.
//  canvas/네이티브 의존성 없이 BGRA 픽셀 버퍼를 만들어 nativeImage.createFromBitmap 으로 넘긴다.
//  (main.ts 에서 process.platform !== 'darwin' 일 때만 import/사용)
// ============================================================================
import { nativeImage, type NativeImage } from 'electron';

export type TrayLevel = 'failure' | 'critical' | 'warning' | 'healthy' | 'none';

// 상태별 배경색 (R, G, B)
const COLORS: Record<TrayLevel, [number, number, number]> = {
  failure: [185, 28, 28], // 진한 빨강 (요청 실패)
  critical: [239, 68, 68], // 빨강 (심각)
  warning: [234, 179, 8], // 노랑 (주의)
  healthy: [34, 197, 94], // 초록 (정상)
  none: [120, 130, 145], // 회색 (endpoint 없음)
};

// 5×7 비트맵 폰트. 각 숫자는 7개 행, 하위 5비트가 픽셀 (b4 = 왼쪽).
const FONT: Record<string, number[]> = {
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
};

const SIZE = 32; // 물리 픽셀 (HiDPI 대비)
const SCALE_FACTOR = 2; // 논리 16×16 으로 표시

function setPx(buf: Buffer, x: number, y: number, b: number, g: number, r: number, a: number) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  buf[i] = b;
  buf[i + 1] = g;
  buf[i + 2] = r;
  buf[i + 3] = a;
}

function drawGlyph(
  buf: Buffer,
  rows: number[],
  x0: number,
  y0: number,
  scale: number,
  r: number,
  g: number,
  b: number,
) {
  for (let ry = 0; ry < 7; ry++) {
    const bits = rows[ry];
    for (let rx = 0; rx < 5; rx++) {
      if (bits & (1 << (4 - rx))) {
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPx(buf, x0 + rx * scale + sx, y0 + ry * scale + sy, b, g, r, 255);
          }
        }
      }
    }
  }
}

export function makeTrayIcon(level: TrayLevel, count: number): NativeImage {
  const buf = Buffer.alloc(SIZE * SIZE * 4); // BGRA, 전부 0(투명)으로 시작
  const [r, g, b] = COLORS[level];

  // 상태색 원
  const c = SIZE / 2 - 0.5;
  const radius = SIZE / 2 - 1;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - c;
      const dy = y - c;
      if (dx * dx + dy * dy <= radius * radius) {
        setPx(buf, x, y, b, g, r, 255);
      }
    }
  }

  // 개수 숫자 (0 이면 색 원만)
  if (count > 0) {
    const text = count > 99 ? '99' : String(count);
    // 노란 배경엔 어두운 글씨, 그 외엔 흰 글씨 (대비 확보)
    const tone = level === 'warning' ? 20 : 255;
    const scale = text.length === 1 ? 4 : 2;
    const glyphW = 5 * scale;
    const glyphH = 7 * scale;
    const gap = scale;
    const totalW = text.length * glyphW + (text.length - 1) * gap;
    let x = Math.round((SIZE - totalW) / 2);
    const y = Math.round((SIZE - glyphH) / 2);

    for (const ch of text) {
      const glyph = FONT[ch];
      if (glyph) drawGlyph(buf, glyph, x, y, scale, tone, tone, tone);
      x += glyphW + gap;
    }
  }

  return nativeImage.createFromBitmap(buf, {
    width: SIZE,
    height: SIZE,
    scaleFactor: SCALE_FACTOR,
  });
}
