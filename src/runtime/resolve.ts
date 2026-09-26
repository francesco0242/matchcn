// Stage 4 (Resolve), per docs/ARCHITECTURE.md. One optional classifier.dev
// Choice call over the top candidates from Match, with their full
// descriptions, so the model judges from real content instead of just the
// dimension vector distance. Always includes "none of these": confidence
// on a Choice answer measures which label fits best, not whether any of
// them are actually a fit (docs/DIMENSIONS.md), so without this option a
// weak field of candidates would still force a pick.
//
// Skipped when Match's top candidate is clearly ahead of the runner-up
// AND itself confident, see shouldSkipResolve. This is what saves the
// round trip on an easy brief.

import { classifyChunk } from "./classify.js";
import type { DimensionDef } from "./dimensions.js";
import type { TagRecord } from "./types.js";

export const RESOLVE_CONFIDENCE_FLOOR = 0.55; // top match must clear this to skip Resolve
export const RESOLVE_GAP_FLOOR = 0.15; // and be at least this much closer than the runner-up

export interface RankedCandidate {
  record: TagRecord;
  distance: number;
}

export function shouldSkipResolve(ranked: RankedCandidate[]): boolean {
  if (ranked.length === 0) return true; // nothing to resolve
  if (ranked.length === 1) return 1 - ranked[0].distance >= RESOLVE_CONFIDENCE_FLOOR;
  const topConfidence = 1 - ranked[0].distance;
  const gap = ranked[1].distance - ranked[0].distance;
  return topConfidence >= RESOLVE_CONFIDENCE_FLOOR && gap >= RESOLVE_GAP_FLOOR;
}

export interface ResolveResult {
  label: string | null; // one of the candidate keys, or "none of these", or null if unanswered
  confidence: number | null;
  decisionsSpent: number;
}

// Includes compositionLevel, not just registry/name: at least one
// registry (aceternity) publishes two genuinely different entries under
// the identical name, distinguished only by compositionLevel (a
// registry:ui primitive and a registry:block demo both named
// "background-lines", see docs/DECISIONS.md #16, which fixed this same
// collision for the tagger's checkpoint key). registry/name alone would
// silently collide the two here too: resolveAmbiguous would emit
// duplicate labels in the same classifier.dev choice call, and the
// reorder-by-label lookup in pick.ts would match whichever of the two
// happens to come first, not necessarily the one the model actually
// picked (GitHub issue #24).
export function candidateKey(record: TagRecord): string {
  return `${record.registry}/${record.name}/${record.compositionLevel}`;
}

// visual_density is a noul (continuous probability), not a labeled choice
// like the others here; render it as a short human-readable phrase for
// the resolve prompt instead of a raw number.
function densityPhrase(probability: number | null): string {
  if (probability == null) return "unknown";
  if (probability < 0.35) return "sparse";
  if (probability > 0.65) return "dense";
  return "moderate";
}

function candidateDescription(record: TagRecord): string {
  const d = record.dimensions;
  return (
    `${record.title ?? record.name} (${record.registry}, ${record.compositionLevel}). ` +
    `category: ${d.category.label ?? "unknown"}. motion: ${d.motion.label ?? "unknown"}. ` +
    `visual density: ${densityPhrase(d.visual_density.probability)}. interaction: ${d.interaction_model.label ?? "unknown"}.`
  );
}

// Sends one Choice call: "which of these up-to-5 candidates best matches
// the brief, or none of these." One item (the brief text), one dimension,
// so this always costs exactly 1 decision.
export async function resolveAmbiguous(brief: string, top: RankedCandidate[]): Promise<ResolveResult> {
  const candidates = top.slice(0, 5);
  const labels = [...candidates.map((c) => candidateKey(c.record)), "none of these"];

  const descriptions = candidates.map((c) => `- ${candidateKey(c.record)}: ${candidateDescription(c.record)}`).join("\n");

  const dimension: DimensionDef = {
    key: "pick",
    kind: "choice",
    labels,
    instructions:
      "Given the user's brief as the input, and these candidate UI components, pick the single candidate that best matches what the brief is asking for. Judge from each candidate's actual category, motion, visual density, and interaction properties listed below, not just its name. If none of the candidates genuinely fit what the brief is asking for, pick \"none of these\" rather than forcing a pick.\n\nCandidates:\n" +
      descriptions,
  };

  const result = await classifyChunk([brief], [dimension]);
  const answer = result.results[0]?.dimensions["pick"];

  return {
    label: answer?.label ?? null,
    confidence: answer?.confidence ?? null,
    decisionsSpent: 1,
  };
}
