// Parses a user's plain-language brief into the same dimension shape used
// for tagging. This is the one model call in Match (docs/ARCHITECTURE.md
// stage 3): one classifier.dev request, treating the brief as a single
// "item" classified against the same DIMENSIONS array from
// src/dimensions.ts that src/tagger.ts uses to tag components. Reusing the
// exact same import, not a hand-copied second definition, is what
// guarantees brief and component land in the same label space; a
// separately-worded criteria for match-time would silently break
// comparability, which is the whole reason this module does not define
// its own dimension text.
//
// parseBrief itself takes the brief text as-is, with no translation call
// of its own -- but its caller, pick.ts, runs translateBriefToEnglish
// first (see translate.ts, added for docs/DECISIONS.md #17), so a
// non-English brief reaching parseBrief has normally already been
// translated to English by the time it gets here. Non-English support is
// real and tested (translate.test.ts), just not implemented in this file.

import { DIMENSIONS } from "./dimensions.js";
import { classifyChunk } from "./classify.js";
import { toChoiceAnswer, toNoulAnswer } from "./answer-convert.js";
import type { TagRecord } from "./types.js";

export type DimensionVector = TagRecord["dimensions"];

export interface ParsedBrief {
  dimensions: DimensionVector;
  decisionsSpent: number;
}

export async function parseBrief(brief: string): Promise<ParsedBrief> {
  const result = await classifyChunk([brief], DIMENSIONS);
  const dims = result.results[0]?.dimensions ?? {};

  const dimensions: DimensionVector = {
    category: toChoiceAnswer(dims["category"]),
    motion: toChoiceAnswer(dims["motion"]),
    visual_density: toNoulAnswer(dims["visual_density"]),
    interaction_model: toChoiceAnswer(dims["interaction_model"]),
    needs_external_data: toNoulAnswer(dims["needs_external_data"]),
    decorative_only: toNoulAnswer(dims["decorative_only"]),
    domain: toChoiceAnswer(dims["domain"]),
  };

  return { dimensions, decisionsSpent: DIMENSIONS.length };
}

// Structured hints a calling agent fills in itself, instead of having
// parseBrief spend a classifier.dev round trip guessing them from prose.
// The caller is the strongest model in the chain and already knows what
// it is building (docs/ROADMAP.md, thesis 1), so its own read of the
// brief is at least as good as a small classifier's. Keys mirror
// DIMENSIONS; the three noul dimensions take a plain yes/no (or
// sparse/dense) because "probability 0.83" is not something a caller can
// meaningfully state.
export interface BriefHints {
  category?: string;
  motion?: string;
  interaction_model?: string;
  domain?: string;
  visual_density?: "sparse" | "dense";
  needs_external_data?: boolean;
  decorative_only?: boolean;
}

// Labels a caller may hint for each choice dimension: the same frozen
// label lists the tagger used, minus "none of these" (a hint of "none"
// says nothing useful to rank by; omitting the key says the same thing).
export function hintableLabels(key: string): string[] {
  const dim = DIMENSIONS.find((d) => d.key === key);
  return (dim?.labels ?? []).filter((l) => l !== "none of these");
}

// A stated hint is certain from the caller's side, so choice hints get
// confidence 1 and noul hints sit near the ends of the scale. Not exactly
// 0/1: tagged noul probabilities rarely reach the extremes, and 0.9/0.1
// keeps a confident tag (say 0.85) close rather than maximally penalized
// for not being literally 1.0. Any dimension the caller left out becomes
// a null answer, which match.ts weighs at 0 -- skipped, not penalized.
const NOUL_HINT_HIGH = 0.9;
const NOUL_HINT_LOW = 0.1;

function hintChoice(label: string | undefined) {
  return label ? { label, confidence: 1, scores: null } : { label: null, confidence: null, scores: null };
}

function hintNoul(value: boolean | undefined) {
  return { probability: value == null ? null : value ? NOUL_HINT_HIGH : NOUL_HINT_LOW };
}

export function hasHints(hints: BriefHints | undefined): hints is BriefHints {
  return hints != null && Object.values(hints).some((v) => v != null);
}

export function briefFromHints(hints: BriefHints): DimensionVector {
  return {
    category: hintChoice(hints.category),
    motion: hintChoice(hints.motion),
    visual_density: hintNoul(hints.visual_density == null ? undefined : hints.visual_density === "dense"),
    interaction_model: hintChoice(hints.interaction_model),
    needs_external_data: hintNoul(hints.needs_external_data),
    decorative_only: hintNoul(hints.decorative_only),
    domain: hintChoice(hints.domain),
  };
}
