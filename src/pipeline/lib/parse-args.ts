// Shared by tag.ts and pilot.ts, both of which parse a numeric CLI flag
// (--limit, --size, --min-aceternity-primitives) that silently became NaN
// on a malformed value (typo, shell-quoting mistake) before this existed,
// corrupting downstream computation instead of failing with a clear,
// actionable error.
export function parsePositiveInt(raw: string | undefined, flagName: string): number | undefined;
export function parsePositiveInt(raw: string | undefined, flagName: string, fallback: number): number;
export function parsePositiveInt(raw: string | undefined, flagName: string, fallback?: number): number | undefined {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`Invalid ${flagName} value "${raw}": expected a non-negative integer.`);
    process.exit(1);
  }
  return n;
}
