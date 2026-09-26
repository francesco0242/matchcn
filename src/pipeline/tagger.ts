// Stage 2 (Tag), per docs/ARCHITECTURE.md. Chunked, checkpointed, resumable.
// Never coerces a null confidence or score: docs/DIMENSIONS.md and the
// non-negotiable constraints in docs/WHY.md are explicit that null must
// stay null and route to review, not default to 0 or 1.

// The dedup/checkpoint key includes compositionLevel, not just
// registry/name, because at least one registry (aceternity) publishes two
// genuinely different entries under the identical name (a registry:ui
// primitive and a registry:block demo both named "background-lines", see
// docs/DECISIONS.md #16). registry/name alone silently collapsed them
// into one during the full run; this key keeps both.
function componentKey(c: { registry: string; name: string; compositionLevel: string }): string {
  return `${c.registry}/${c.name}/${c.compositionLevel}`;
}

// Pure routing for a chunk-classification failure, factored out of the
// try/catch below so it can be unit-tested without a real network call:
// recognized errors mean "stop this run cleanly, it's retryable later"
// (with stoppedForQuota set only for actual quota exhaustion, so callers
// can tell that apart from a stuck/unavailable batch); anything else
// means the caller should rethrow.
export function classifyErrorOutcome(err: unknown): { stoppedForQuota: boolean } | null {
  if (err instanceof ClassifyQuotaExhaustedError) return { stoppedForQuota: true };
  if (err instanceof ClassifyBatchUnavailableError || err instanceof ClassifySpendingLimitError) {
    return { stoppedForQuota: false };
  }
  return null;
}

import { join } from "node:path";
import { DIMENSIONS, CHOICE_DIMENSIONS, NOUL_DIMENSIONS } from "../runtime/dimensions.js";
import {
  classifyChunk,
  ClassifyBatchUnavailableError,
  ClassifySpendingLimitError,
  ClassifyQuotaExhaustedError,
} from "../runtime/classify.js";
import { toChoiceAnswer, toNoulAnswer } from "../runtime/answer-convert.js";
import { readJsonCache, writeJsonCache } from "../runtime/lib/cache.js";
import { sleep } from "../runtime/lib/concurrency.js";
import type { NormalizedComponent, TagRecord } from "../runtime/types.js";

const DECISIONS_PER_REQUEST_CAP = 1000;
// Lowered from 150 (900 decisions/chunk) after a 900-decision chunk was
// rejected with HTTP 402 request_spending_limit ($0.01 cap per attempt,
// separate from and much smaller than the 20,000/day RateLimit-Remaining
// quota, first seen while tagging cnippet/uiable). 50 x 6 = 300 decisions
// confirmed to fit reliably during that run; keeping headroom below the
// $0.01 ceiling since its available room varies over time.
const CHUNK_SIZE = 50;
const MAX_INPUT_CHARS = 32000;
const INTER_CHUNK_DELAY_MS = 500;

if (CHUNK_SIZE * DIMENSIONS.length > DECISIONS_PER_REQUEST_CAP) {
  throw new Error(
    `CHUNK_SIZE (${CHUNK_SIZE}) x dimensions (${DIMENSIONS.length}) exceeds the ${DECISIONS_PER_REQUEST_CAP}-decision cap`,
  );
}

interface Checkpoint {
  taggedNames: string[]; // "registry/name"
  decisionsSpent: number;
  lastRateLimitRemaining: number | null;
  lastRateLimitObservedAtMs: number | null;
  updatedAt: string;
}

// How long a remembered RateLimit-Remaining is trusted for the
// pre-request throttle check below. classifier.dev's header tracks a
// per-minute window (confirmed in docs/PILOT_REPORT.md), so a value from
// more than this long ago tells us nothing about the current window; the
// real, current answer only comes from actually sending a request and
// reading its response (429 + Retry-After is handled in classify.ts
// regardless). Skipping a chunk based on stale data from a previous
// process run was a real bug: it blocked every subsequent run forever
// even after the window had clearly reset, since nothing ever refreshed
// the number. This constant exists so the in-run throttle (stop mid-run
// if the last response in THIS run says we are out of room) still works
// without that failure mode across separate invocations.
const RATE_LIMIT_TRUST_WINDOW_MS = 5_000;

export interface TaggingSummary {
  registry: string;
  attempted: number;
  tagged: number;
  skippedAlreadyTagged: number;
  decisionsSpent: number;
  rateLimitRemaining: number | null;
  stoppedForQuota: boolean;
  chunksSent: number;
}

export interface RunTaggingOptions {
  registry: string;
  components: NormalizedComponent[];
  outputPath: string;
  checkpointDir: string;
  limit?: number;
  dailyQuotaFloor?: number; // stop if remaining quota would dip below this
}

export async function runTagging(opts: RunTaggingOptions): Promise<TaggingSummary> {
  const checkpointPath = join(opts.checkpointDir, `tag-checkpoint-${opts.registry}.json`);
  const checkpoint = (await readJsonCache<Checkpoint>(checkpointPath)) ?? {
    taggedNames: [],
    decisionsSpent: 0,
    lastRateLimitRemaining: null,
    lastRateLimitObservedAtMs: null,
    updatedAt: new Date().toISOString(),
  };
  const existing = (await readJsonCache<TagRecord[]>(opts.outputPath)) ?? [];
  const output = [...existing];

  // Union of the checkpoint's claimed-tagged names and whatever is
  // actually present in the output file, not the checkpoint alone. Output
  // is now written before the checkpoint (see the write order below), so
  // a crash between those two writes leaves output ahead of checkpoint;
  // trusting the checkpoint alone here would re-tag and duplicate those
  // components in `output` instead of correctly recognizing them as done.
  const taggedSet = new Set([...checkpoint.taggedNames, ...existing.map((r) => componentKey(r))]);

  let pending = opts.components.filter((c) => !taggedSet.has(componentKey(c)));
  const skippedAlreadyTagged = opts.components.length - pending.length;

  // Defensive: classifier.dev rejects empty input strings with a 400 for
  // the whole chunk. A component with nothing to tag (see docs/DECISIONS.md
  // #14 for the registry:style case this caught) should never crash a
  // batch of otherwise-good components; skip it and say so.
  const emptyInput = pending.filter((c) => c.taggingText.trim().length === 0);
  if (emptyInput.length > 0) {
    console.warn(
      `[${opts.registry}] skipping ${emptyInput.length} component(s) with empty taggingText: ` +
        emptyInput.map((c) => c.name).join(", "),
    );
    pending = pending.filter((c) => c.taggingText.trim().length > 0);
  }

  if (opts.limit != null) pending = pending.slice(0, opts.limit);

  const summary: TaggingSummary = {
    registry: opts.registry,
    attempted: pending.length,
    tagged: 0,
    skippedAlreadyTagged,
    decisionsSpent: 0,
    rateLimitRemaining: checkpoint.lastRateLimitRemaining,
    stoppedForQuota: false,
    chunksSent: 0,
  };

  const floor = opts.dailyQuotaFloor ?? CHUNK_SIZE * DIMENSIONS.length;

  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    const chunk = pending.slice(i, i + CHUNK_SIZE);
    const decisionsForChunk = chunk.length * DIMENSIONS.length;

    const rateLimitDataIsFresh =
      checkpoint.lastRateLimitObservedAtMs != null &&
      Date.now() - checkpoint.lastRateLimitObservedAtMs < RATE_LIMIT_TRUST_WINDOW_MS;
    if (rateLimitDataIsFresh && checkpoint.lastRateLimitRemaining != null && checkpoint.lastRateLimitRemaining < floor) {
      summary.stoppedForQuota = true;
      break;
    }

    const items = chunk.map((c) => c.taggingText.slice(0, MAX_INPUT_CHARS));

    let result;
    try {
      result = await classifyChunk(items, DIMENSIONS);
    } catch (err) {
      const outcome = classifyErrorOutcome(err);
      if (outcome) {
        // Retryable in a later run; stop here rather than losing the
        // whole run to one stuck chunk. Checkpoint already reflects
        // everything before this chunk.
        console.error(`[${opts.registry}] chunk failed, stopping run: ${(err as Error).message}`);
        summary.stoppedForQuota = outcome.stoppedForQuota;
        break;
      }
      throw err;
    }

    summary.chunksSent++;

    for (let j = 0; j < chunk.length; j++) {
      const component = chunk[j];
      const dims = result.results[j]?.dimensions ?? {};
      const record: TagRecord = {
        registry: component.registry,
        name: component.name,
        title: component.title,
        compositionLevel: component.compositionLevel,
        sourceUrl: component.sourceUrl,
        variants: component.variants,
        dimensions: {
          category: toChoiceAnswer(dims["category"]),
          motion: toChoiceAnswer(dims["motion"]),
          visual_density: toNoulAnswer(dims["visual_density"]),
          interaction_model: toChoiceAnswer(dims["interaction_model"]),
          needs_external_data: toNoulAnswer(dims["needs_external_data"]),
          decorative_only: toNoulAnswer(dims["decorative_only"]),
          domain: toChoiceAnswer(dims["domain"]),
        },
        taggedAt: new Date().toISOString(),
        inputCharCount: items[j].length,
      };
      output.push(record);
      taggedSet.add(componentKey(component));
      summary.tagged++;
    }

    summary.decisionsSpent += decisionsForChunk;
    checkpoint.decisionsSpent += decisionsForChunk;
    checkpoint.lastRateLimitRemaining = result.rateLimitRemaining;
    checkpoint.lastRateLimitObservedAtMs = Date.now();
    checkpoint.taggedNames = [...taggedSet];
    checkpoint.updatedAt = new Date().toISOString();
    summary.rateLimitRemaining = result.rateLimitRemaining;

    // Output is written BEFORE the checkpoint. If the process is killed
    // between the two writes, the checkpoint understates progress but the
    // tagged records are already safely on disk in `output` -- the next
    // run's taggedSet (built above from checkpoint UNION output) still
    // recognizes them as done, so nothing is lost or duplicated. The
    // reverse order (checkpoint first, as this used to be) risked the
    // checkpoint claiming a chunk was tagged while its records were never
    // actually written, silently and permanently dropping them.
    await writeJsonCache(opts.outputPath, output);
    await writeJsonCache(checkpointPath, checkpoint);

    if (i + CHUNK_SIZE < pending.length) await sleep(INTER_CHUNK_DELAY_MS);
  }

  return summary;
}

export { CHOICE_DIMENSIONS, NOUL_DIMENSIONS, CHUNK_SIZE };
