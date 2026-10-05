/** Client-safe formatting helpers (no Node imports). */
export function dollars(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}
