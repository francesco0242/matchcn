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
