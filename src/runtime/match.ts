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
export function choiceWeight(answer: ChoiceAnswer): number {
  return answer.confidence ?? 0;
}

export function noulWeight(answer: NoulAnswer): number {
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

// Crude plural stemming (strip a trailing "s", not "ss"), not a real
// stemmer: found empirically necessary when a real eval run showed
// "sign-in-forms-01" (an actual login form) scoring zero text overlap
// against a "login form" brief purely because "forms" != "form" as
// distinct tokens. A real stemming library is overkill for slug/title
// vocabulary this short; this one heuristic closed the specific gap
// observed without a dependency.
function stem(token: string): string {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
      .map(stem),
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

// How many candidates in the ranking pool contain each token in their
// name/title. Powers the IDF weighting below: a token that appears in a
// handful of components ("login") is far more discriminating than one
// that appears in hundreds ("form", "button", "card"), so a shared rare
// word should count for much more than a shared common one. Built once
// per rankCandidates call over the actual candidate pool, not a fixed
// global list, so it reflects the real catalog's vocabulary.
function buildDocumentFrequency(candidates: TagRecord[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const record of candidates) {
    for (const t of tokenize(candidateText(record))) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  return df;
}

// Smoothed inverse document frequency, always positive: a token with
// zero measured document frequency (e.g. one only ever seen in the brief,
// never in any candidate name/title) still gets a real, maximal weight
// rather than zero or a division-by-zero.
function idf(token: string, df: Map<string, number>, totalDocs: number): number {
  const docFreq = df.get(token) ?? 0;
  return Math.log((totalDocs + 1) / (docFreq + 1)) + 1;
}

// TF-IDF cosine distance in [0, 1] (0 = identical weighted vocabulary,
// 1 = no shared tokens at all). Originally a plain, unweighted Jaccard
// overlap: added because most of the tagged dimensions are purely
// structural (motion, density, interaction model, ...), so two
// components that are both "form-input" + "static" + "auth" were
// indistinguishable to weightedDistance even when one is an actual login
// form and the other is, say, an OTP field -- the exact failure mode a
// real eval run reproduced: "a login form with email and password
// fields" ranked `field-one-time-password-form` above all 7 real
// login-form components in the catalog, with the real logins landing as
// far down as rank #35 of 4,578 (outside the top-5 window ever shown to
// Resolve), because plain Jaccard let "password"+"form" (2 shared but
// extremely common words) outweigh "login" (1 shared but far more
// distinctive word).
//
// Two follow-up fixes were needed before this actually worked, found by
// checking real numbers rather than assuming the first idea would work:
// - Weighting by document frequency alone, combined with a union-based
//   (Jaccard) denominator, still penalized short candidate titles (e.g.
//   "Login 1") for not containing every word in a longer brief, even
//   when every word the candidate DOES have is a perfect match.
// - Switching to an overlap coefficient (divide by the smaller side
//   instead of the union) fixed that, but over-rewarded near-empty
//   candidate titles: a candidate whose only token is the common word
//   "form" would score a "perfect" 0 distance just because its tiny
//   vocabulary is fully contained in the brief's.
// Cosine similarity between the two TF-IDF vectors (magnitude-normalized
// by each side's own vocabulary, not the union or the smaller side) is
// the standard fix for both failure modes at once, and is what a
// real re-run of the login-form repro confirmed: the real login-form
// components moved from rank #7-#35 to rank #1-#4 of 4,578, essentially
// tied with the wrong OTP/reset candidates instead of losing by an order
// of magnitude -- exactly the near-tie Resolve exists to break with real
// descriptions, not a case Match should try to force a verdict on alone.
function cosineTextDistance(briefTokens: Set<string>, record: TagRecord, df: Map<string, number>, totalDocs: number): number {
  const candidateTokens = tokenize(candidateText(record));
  if (briefTokens.size === 0 || candidateTokens.size === 0) return 1;

  let dot = 0;
  let briefNormSq = 0;
  let candidateNormSq = 0;
  for (const t of briefTokens) briefNormSq += idf(t, df, totalDocs) ** 2;
  for (const t of candidateTokens) {
    const w = idf(t, df, totalDocs);
    candidateNormSq += w ** 2;
    if (briefTokens.has(t)) dot += w ** 2;
  }
  if (briefNormSq === 0 || candidateNormSq === 0) return 1;
  const cosineSimilarity = dot / (Math.sqrt(briefNormSq) * Math.sqrt(candidateNormSq));
  return 1 - cosineSimilarity;
}

// Weight for the text-overlap term, blended alongside the tagged
// dimensions' confidence-based weights. Not confidence-weighted itself
// (there is no model confidence for a deterministic word-overlap check).
// Raised from the original 0.5 (plain-Jaccard era) to 1.5: at 0.5, even
// the corrected TF-IDF cosine signal was not enough to overcome the
// structural distance's dominance for the login-form repro above (real
// login components have unrelated `category` tags in a few cases, e.g.
// "card" instead of "form-input", inflating their structural distance);
// 1.5 was confirmed against a full re-run of the eval suite (see
// docs/EVAL_REPORT.md) to bring the real login-form components into a
// near-tie for the top rank without regressing any previously-correct
// confident/shortlist outcome (bento-grid, mouse-trail, etc. unchanged).
const TEXT_WEIGHT = 1.5;

export function rankCandidates(
  brief: DimensionVector,
  candidates: TagRecord[],
  briefText?: string,
): Array<{ record: TagRecord; distance: number }> {
  const briefTokens = briefText ? tokenize(briefText) : null;
  const df = briefTokens ? buildDocumentFrequency(candidates) : null;
  return candidates
    .map((record) => {
      const structuralDistance = weightedDistance(brief, record.dimensions);
      const distance =
        briefTokens && df
          ? (structuralDistance * 1 + cosineTextDistance(briefTokens, record, df, candidates.length) * TEXT_WEIGHT) / (1 + TEXT_WEIGHT)
          : structuralDistance;
      return { record, distance };
    })
    .sort((a, b) => a.distance - b.distance);
}
