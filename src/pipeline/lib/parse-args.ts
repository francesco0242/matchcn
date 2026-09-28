// Shared by tag.ts and pilot.ts, both of which parse a numeric CLI flag
// (--limit, --size, --min-aceternity-primitives) that silently became NaN
// on a malformed value (typo, shell-quoting mistake) before this existed,
// corrupting downstream computation instead of failing with a clear,
// actionable error.
export function parsePositiveInt(raw: string | undefined, flagName: string): number | undefined;
export function parsePositiveInt(raw: string | undefined, flagName: string, fallback: number): number;
export function parsePositiveInt(raw: string | undefined, flagName: string, fallback?: number): number | undefined {
  // "" (from a shell substitution like --limit=$LIMIT with $LIMIT unset,
  // producing the literal token "--limit=") falls back the same as a
  // wholly absent flag, not through Number("") === 0: that would
  // silently limit a run to zero components instead of either erroring
  // or falling back to "unlimited", the exact silent-corruption failure
  // mode this function exists to close.
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`Invalid ${flagName} value "${raw}": expected a non-negative integer.`);
    process.exit(1);
  }
  return n;
}
