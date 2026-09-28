// Shared by ingest.ts and enrich.ts, which previously each defined their
// own copy of this identical function, cross-referenced only by comment
// ("same name-fallback rule as ...'s baseText") rather than actually
// sharing one implementation.
//
// Falls back to `name` when both title and description are empty or
// missing, so a component never ends up with zero taggable text (found on
// cnippet: 69 items, mostly bare registry:ui primitives, with no title or
// description at all). Applies to every registry, not just cnippet, in
// case a future registry has the same gap.
export function baseText(title: string | null, description: string | null, name: string): string {
  const text = [title, description].filter(Boolean).join(". ");
  return text || name;
}
