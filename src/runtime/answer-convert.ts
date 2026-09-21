// Converts classifier.dev's raw per-dimension answer into this project's
// stored shape. Shared by src/tagger.ts (tagging a component) and
// src/brief.ts (parsing a user brief), so a component's tags and a
// brief's parsed intent are built by the exact same code, not two
// separately-maintained copies that could quietly drift apart.

import type { RawDimensionAnswer } from "./classify.js";
import type { ChoiceAnswer, NoulAnswer } from "./types.js";

export function toChoiceAnswer(raw: RawDimensionAnswer | undefined): ChoiceAnswer {
  return {
    label: raw?.label ?? null,
    confidence: raw?.confidence ?? null,
    scores: raw?.scores ?? null,
    model: raw?.model,
    ms: raw?.ms,
  };
}

export function toNoulAnswer(raw: RawDimensionAnswer | undefined): NoulAnswer {
  let probability: number | null = null;
  if (raw?.scores && typeof raw.scores.yes === "number") {
    probability = raw.scores.yes;
  } else if (raw?.label === "yes" && typeof raw.confidence === "number") {
    probability = raw.confidence;
  } else if (raw?.label === "no" && typeof raw.confidence === "number") {
    probability = 1 - raw.confidence;
  }
  return { probability, model: raw?.model, ms: raw?.ms };
}
