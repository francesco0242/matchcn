// Stage 3 (Match) distance function. See docs/DECISIONS.md #15 for why
// this is confidence-weighted: a low-confidence tag should contribute
// little to a match, automatically, rather than needing every dimension's
// criteria to be independently perfect before the dimension can be
// trusted. This is a structural fix, not a per-dimension patch, and it
// applies to any dimension, present or future, not just visual_density.
//
// This module is the pure ranking function only. It does not yet parse a
// user brief into a dimension vector (that needs its own classifier.dev
// call, per docs/ARCHITECTURE.md stage 3) or expose an MCP tool; those are
// separate, later pieces of the Match/Resolve/Surface stages.

import { DIMENSIONS } from "./dimensions.js";
import type { TagRecord, ChoiceAnswer, NoulAnswer } from "./types.js";

export type DimensionVector = TagRecord["dimensions"];

// How much a single dimension's answer counts toward total distance.
// - A choice/choice-ordered answer's weight is its confidence. Null
//   confidence (an unanswered or smart-escalated field, or here, the
//   scores-missing edge case in the noul-as-two-label conversion) gets
//   weight 0: the lowest possible weight, never the highest. A null
//   confidence is not "coin flip, count it half", it means we have no
//   basis to trust this answer at all, so it should count for nothing.
// - A noul answer has no confidence field by definition (docs/DIMENSIONS.md).
//   Its weight is derived from how far the probability sits from 0.5,
//   scaled to [0, 1]: 0.5 (genuinely uncertain) weighs 0, 0.0 or 1.0
//   (confident either way) weighs 1. A null probability weighs 0.
function choiceWeight(answer: ChoiceAnswer): number {
  return answer.confidence ?? 0;
}

function noulWeight(answer: NoulAnswer): number {
  if (answer.probability == null) return 0;
  return Math.abs(answer.probability - 0.5) * 2;
}

// Distance between two choice answers, 0 (identical) to 1 (maximally
// different). Ordered dimensions score partial distance by label index
// (adjacent labels are closer than distant ones); unordered dimensions
// are binary, same label or not.
function choiceDistance(a: ChoiceAnswer, b: ChoiceAnswer, labels: string[], ordered: boolean): number {
  if (a.label == null || b.label == null) return 1;
  if (a.label === b.label) return 0;
  if (!ordered) return 1;
  const ia = labels.indexOf(a.label);
  const ib = labels.indexOf(b.label);
  if (ia === -1 || ib === -1) return 1;
  return Math.abs(ia - ib) / (labels.length - 1);
}

function noulDistance(a: NoulAnswer, b: NoulAnswer): number {
  if (a.probability == null || b.probability == null) return 1;
  return Math.abs(a.probability - b.probability);
}

// Weighted distance between a brief's dimension vector and one tagged
// component's dimension vector, in [0, 1] (0 = perfect match). A
// dimension present in `brief` but with weight 0 on the candidate side
// (or vice versa) contributes 0 distance and 0 weight, effectively
// skipping it rather than penalizing either side for a low-confidence
// answer. If every dimension ends up weight 0 (should not happen in
// practice given `needs_external_data`/`decorative_only` are rarely
// exactly 0.5), the result is 1 (maximal distance, no basis to claim a
// match) rather than a division by zero.
export function weightedDistance(brief: DimensionVector, candidate: DimensionVector): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const dim of DIMENSIONS) {
    const key = dim.key as keyof DimensionVector;
    const briefAnswer = brief[key];
    const candidateAnswer = candidate[key];

    if (dim.kind === "noul") {
      const b = briefAnswer as NoulAnswer;
      const c = candidateAnswer as NoulAnswer;
      const weight = Math.min(noulWeight(b), noulWeight(c));
      if (weight === 0) continue;
      weightedSum += noulDistance(b, c) * weight;
      totalWeight += weight;
    } else {
      const b = briefAnswer as ChoiceAnswer;
      const c = candidateAnswer as ChoiceAnswer;
      const weight = Math.min(choiceWeight(b), choiceWeight(c));
      if (weight === 0) continue;
      const distance = choiceDistance(b, c, dim.labels!, dim.kind === "choice-ordered");
      weightedSum += distance * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 1;
  return weightedSum / totalWeight;
}

// Stopwords filtered out before token overlap: brief sentences are full
// English prose ("a hero section with a headline"), and function words
// would otherwise contribute equal, non-discriminating overlap against
// every candidate regardless of actual topical relevance.
const STOPWORDS = new Set([
  "a", "an", "the", "with", "and", "or", "for", "to", "of", "in", "on",
  "that", "this", "is", "are", "it", "its", "at", "by", "from", "as",
  "showing", "using", "each", "some",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

// A component's only runtime text is its `name` (a slug, always present)
// and `title` (often null, especially for registries whose index never
// set one, e.g. cnippet at 0% and many aceternity page-templates). The
// full description used at tagging time is not persisted in TagRecord,
// so this is the only text signal available at match time.
function candidateText(record: TagRecord): string {
  return `${record.title ?? ""} ${record.name}`;
}

// Distance in [0, 1] from Jaccard overlap between brief and candidate
// tokens (0 = every candidate token appears in the brief, 1 = no shared
// tokens at all). Originally added because most of the tagged dimensions
// are purely structural (motion, density, interaction model, ...): two
// components that are both "form-input" + "static" + "minimal" were
// indistinguishable to weightedDistance even when one is a login form and
// the other is a calendar. A 20-brief pilot found this exact failure mode
// causing most no_match outcomes: a coarse-dimension match with no
// literal-word check at all, so Resolve correctly rejected calendars and
// autocompletes offered up for a "login form" brief. The `domain`
// dimension (auth/scheduling/commerce/...) now gives a real semantic
// signal for this same case, but this word-overlap term is kept as a
// second, independent, zero-cost signal rather than removed. This is
// deterministic word overlap, not a model call, consistent with Match
// staying local code.
function textDistance(briefText: string, record: TagRecord): number {
  const briefTokens = tokenize(briefText);
  const candidateTokens = tokenize(candidateText(record));
  if (briefTokens.size === 0 || candidateTokens.size === 0) return 1;
  let intersection = 0;
  for (const t of candidateTokens) if (briefTokens.has(t)) intersection++;
  const union = briefTokens.size + candidateTokens.size - intersection;
  return 1 - intersection / union;
}

// Fixed weight for the text-overlap term, blended alongside the tagged
// dimensions' confidence-based weights. Not confidence-weighted itself
// (there is no model confidence for a deterministic word-overlap check),
// but kept modest relative to a single dimension's typical weight so it
// nudges ranking toward literal-word matches without letting a brief
// that happens to share a rare word with an unrelated candidate dominate
// the seven tagged dimensions.
const TEXT_WEIGHT = 0.5;

export function rankCandidates(
  brief: DimensionVector,
  candidates: TagRecord[],
  briefText?: string,
): Array<{ record: TagRecord; distance: number }> {
  return candidates
    .map((record) => {
      const structuralDistance = weightedDistance(brief, record.dimensions);
      const distance = briefText
        ? (structuralDistance * 1 + textDistance(briefText, record) * TEXT_WEIGHT) / (1 + TEXT_WEIGHT)
        : structuralDistance;
      return { record, distance };
    })
    .sort((a, b) => a.distance - b.distance);
}
