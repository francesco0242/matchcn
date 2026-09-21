// Core pick_component logic, per docs/ARCHITECTURE.md stages 3-4 (Match,
// Resolve). This is the function both src/mcp-server.ts (the real MCP
// tool) and src/demo.ts (the CLI used to produce the test-brief report)
// call, so the demo output is exactly what the MCP tool would return, not
// a separate approximation of it.
//
// Never returns a forced single guess: docs/WHY.md's non-negotiable
// constraint ("low confidence returns 3 candidates plus the reason, never
// a single silent guess") governs the outcome logic below, and
// docs/DIMENSIONS.md's "none of these" convention governs Resolve.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonCache } from "./lib/cache.js";
import { REGISTRIES } from "./registries.js";
import { DIMENSIONS } from "./dimensions.js";
import { parseBrief } from "./brief.js";
import { rankCandidates } from "./match.js";
import { resolveAmbiguous, shouldSkipResolve, RESOLVE_CONFIDENCE_FLOOR, type RankedCandidate } from "./resolve.js";
import type { TagRecord, ChoiceAnswer, NoulAnswer } from "./types.js";
import type { DimensionVector } from "./brief.js";

// Resolved relative to this module's own location (src/runtime/pick.ts),
// not process.cwd(). A plain join("data", "tags") resolves against
// process.cwd(), which is the caller's directory (wherever `npx matchcn`
// was invoked from), not matchcn's own installed location; that would
// silently fail to find data/tags for every real end user, since
// readJsonCache swallows the resulting ENOENT and returns null (see
// docs/DECISIONS.md for the bug this replaced and how it was verified
// fixed, both running from the repo and running as an installed package
// from an unrelated directory).
const TAGS_DIR = fileURLToPath(new URL("../../data/tags", import.meta.url));

export interface DimensionReason {
  dimension: string;
  briefWants: string | number | null;
  componentHas: string | number | null;
  matched: boolean;
  weight: number;
}

export interface Differentiator {
  dimension: string;
  values: Array<{ name: string; registry: string; value: string | number | null }>;
}

export interface VariantOutput {
  stack: string;
  registryItemName: string;
  installCommand: string;
}

export interface ComponentOutput {
  name: string;
  registry: string;
  title: string | null;
  installCommand: string;
  sourceUrl: string;
  confidence: number;
  reasons: DimensionReason[];
  variants?: VariantOutput[];
}

// Three outcomes, deliberately not two. "shortlist" and "no_match" were
// one combined "unsure" outcome until a real test (a brief whose top 3
// candidates all scored 0.93-0.99 Match confidence) showed that collapsing
// them was wrong: a tie between several good candidates and a field where
// nothing really fits are different situations and need different
// handling. See docs/DECISIONS.md #19.
//   confident  one clear winner, either Match was decisive on its own or
//              Resolve broke the tie with real confidence.
//   shortlist  Resolve considered the candidates plausible (it did not
//              say "none of these") but could not confidently prefer one;
//              ranked candidates come back with the dimension(s) that
//              actually separate them named explicitly.
//   no_match   Resolve read the real candidates and explicitly rejected
//              all of them. Closest candidates are shown for debugging,
//              marked rejected, never returned as an answer.
export type PickOutcome = "confident" | "shortlist" | "no_match";

export interface PickResult {
  outcome: PickOutcome;
  message: string;
  chosen?: ComponentOutput;
  candidates?: ComponentOutput[];
  differentiators?: Differentiator[];
  resolveUsed: boolean;
  decisionsSpent: number;
}

export interface PickOptions {
  brief: string;
  registry?: string;
  maxResults?: number;
}

function installUrl(record: TagRecord): string {
  return record.sourceUrl;
}

function variantOutputs(record: TagRecord): VariantOutput[] | undefined {
  if (!record.variants || record.variants.length === 0) return undefined;
  const registryConfig = REGISTRIES.find((r) => r.name === record.registry);
  if (!registryConfig) return undefined;
  return record.variants.map((v) => ({
    stack: v.stack,
    registryItemName: v.registryItemName,
    installCommand: `npx shadcn@latest add ${registryConfig.itemUrlTemplate.replace("{name}", v.registryItemName)}`,
  }));
}

function buildReasons(brief: DimensionVector, candidate: DimensionVector): DimensionReason[] {
  return DIMENSIONS.map((dim) => {
    const key = dim.key as keyof DimensionVector;
    if (dim.kind === "noul") {
      const b = brief[key] as NoulAnswer;
      const c = candidate[key] as NoulAnswer;
      const weight = b.probability == null || c.probability == null ? 0 : Math.abs((b.probability - 0.5) * 2) * 1;
      const matched = b.probability != null && c.probability != null && Math.abs(b.probability - c.probability) < 0.3;
      return {
        dimension: dim.key,
        briefWants: b.probability,
        componentHas: c.probability,
        matched,
        weight,
      };
    }
    const b = brief[key] as ChoiceAnswer;
    const c = candidate[key] as ChoiceAnswer;
    const weight = Math.min(b.confidence ?? 0, c.confidence ?? 0);
    const matched = b.label != null && c.label != null && b.label === c.label;
    return {
      dimension: dim.key,
      briefWants: b.label,
      componentHas: c.label,
      matched,
      weight,
    };
  });
}

function toComponentOutput(record: TagRecord, confidence: number, brief: DimensionVector): ComponentOutput {
  return {
    name: record.name,
    registry: record.registry,
    title: record.title,
    installCommand: `npx shadcn@latest add ${installUrl(record)}`,
    sourceUrl: record.sourceUrl,
    confidence: Math.round(confidence * 100) / 100,
    reasons: buildReasons(brief, record.dimensions),
    variants: variantOutputs(record),
  };
}

// A dimension "differentiates" a shortlist when the candidates do not
// all agree on it: different labels for a choice dimension, or a spread
// of more than 0.2 in probability for a noul dimension. 0.2 is a plain,
// documented threshold (docs/DECISIONS.md #19), not tuned against data.
const NOUL_SPREAD_THRESHOLD = 0.2;

function computeDifferentiators(records: TagRecord[]): Differentiator[] {
  const out: Differentiator[] = [];
  for (const dim of DIMENSIONS) {
    const key = dim.key as keyof DimensionVector;
    if (dim.kind === "noul") {
      const values = records.map((r) => (r.dimensions[key] as NoulAnswer).probability);
      const known = values.filter((v): v is number => v != null);
      const spread = known.length > 1 ? Math.max(...known) - Math.min(...known) : 0;
      if (spread > NOUL_SPREAD_THRESHOLD) {
        out.push({
          dimension: dim.key,
          values: records.map((r) => ({
            name: r.name,
            registry: r.registry,
            value: (r.dimensions[key] as NoulAnswer).probability,
          })),
        });
      }
    } else {
      const labels = records.map((r) => (r.dimensions[key] as ChoiceAnswer).label);
      const distinct = new Set(labels.filter((l) => l != null));
      if (distinct.size > 1) {
        out.push({
          dimension: dim.key,
          values: records.map((r) => ({
            name: r.name,
            registry: r.registry,
            value: (r.dimensions[key] as ChoiceAnswer).label,
          })),
        });
      }
    }
  }
  return out;
}

async function loadCandidates(registryFilter?: string): Promise<TagRecord[]> {
  const targets = registryFilter ? REGISTRIES.filter((r) => r.name === registryFilter) : REGISTRIES;
  const all: TagRecord[] = [];
  for (const r of targets) {
    const records = await readJsonCache<TagRecord[]>(join(TAGS_DIR, `${r.name}.json`));
    if (records) all.push(...records);
  }
  return all;
}

export async function pickComponent(opts: PickOptions): Promise<PickResult> {
  const maxResults = opts.maxResults ?? 3;
  const candidates = await loadCandidates(opts.registry);

  if (candidates.length === 0) {
    return {
      outcome: "no_match",
      message: opts.registry
        ? `No tagged components found for registry "${opts.registry}".`
        : "No tagged components available.",
      resolveUsed: false,
      decisionsSpent: 0,
    };
  }

  const parsed = await parseBrief(opts.brief);
  let decisionsSpent = parsed.decisionsSpent;

  const ranked: RankedCandidate[] = rankCandidates(parsed.dimensions, candidates);
  const top = ranked.slice(0, Math.max(5, maxResults));

  let resolveUsed = false;
  let resolvedLabel: string | null = null;
  let resolvedConfidence: number | null = null;

  if (!shouldSkipResolve(top)) {
    resolveUsed = true;
    const resolved = await resolveAmbiguous(opts.brief, top);
    decisionsSpent += resolved.decisionsSpent;
    resolvedLabel = resolved.label;
    resolvedConfidence = resolved.confidence;
  }

  // Resolve explicitly said none of the candidates fit. Trust it: it saw
  // real descriptions, Match only saw a dimension-distance number.
  if (resolveUsed && resolvedLabel === "none of these") {
    return {
      outcome: "no_match",
      message:
        "No component in the catalog is a good fit for this brief. Closest candidates are listed below for reference, but none was judged a real match.",
      candidates: top.slice(0, maxResults).map((r) => toComponentOutput(r.record, 1 - r.distance, parsed.dimensions)),
      resolveUsed,
      decisionsSpent,
    };
  }

  // Resolve picked one of the candidates by name; reorder so it leads.
  if (resolveUsed && resolvedLabel) {
    const idx = top.findIndex((r) => `${r.record.registry}/${r.record.name}` === resolvedLabel);
    if (idx > 0) {
      const [picked] = top.splice(idx, 1);
      top.unshift(picked);
    }
  }

  const bestConfidence = resolveUsed && resolvedConfidence != null ? resolvedConfidence : 1 - top[0].distance;

  // Decisive: either Match alone was clear enough to skip Resolve, or
  // Resolve broke the tie with real confidence.
  if (bestConfidence >= RESOLVE_CONFIDENCE_FLOOR) {
    return {
      outcome: "confident",
      message: `Selected "${top[0].record.name}" from ${top[0].record.registry}.`,
      chosen: toComponentOutput(top[0].record, bestConfidence, parsed.dimensions),
      resolveUsed,
      decisionsSpent,
    };
  }

  // Resolve ran, considered the candidates plausible (it did not answer
  // "none of these"), but could not confidently prefer one: a real tie
  // between good candidates, not a field of weak ones. Name what actually
  // separates them rather than just repeating that they all matched.
  const shortlist = top.slice(0, maxResults);
  const differentiators = computeDifferentiators(shortlist.map((r) => r.record));
  const differentiatorNames = differentiators.map((d) => d.dimension);
  const message =
    differentiatorNames.length > 0
      ? `${shortlist.length} strong candidates, no single winner. They differ on: ${differentiatorNames.join(", ")}.`
      : `${shortlist.length} strong candidates, no single winner, and they do not differ on any tagged dimension. Choice between them is not visible to this schema.`;

  return {
    outcome: "shortlist",
    message,
    candidates: shortlist.map((r) => toComponentOutput(r.record, 1 - r.distance, parsed.dimensions)),
    differentiators,
    resolveUsed,
    decisionsSpent,
  };
}
