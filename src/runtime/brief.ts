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
// The brief is passed through as-is regardless of language. See
// docs/DECISIONS.md #17: no separate translation call is made, and
// non-English briefs are untested.

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
    visual_density: toChoiceAnswer(dims["visual_density"]),
    interaction_model: toChoiceAnswer(dims["interaction_model"]),
    needs_external_data: toNoulAnswer(dims["needs_external_data"]),
    decorative_only: toNoulAnswer(dims["decorative_only"]),
  };

  return { dimensions, decisionsSpent: DIMENSIONS.length };
}
