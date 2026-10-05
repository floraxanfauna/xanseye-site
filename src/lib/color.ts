/** Client-safe color helpers. */
function lin(c: number) { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function contrastRatio(a: string, b: string): number {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return 0;
  const L = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const [hi, lo] = [L(A), L(B)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
