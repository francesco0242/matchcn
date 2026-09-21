// HTTP client for classifier.dev's multi-dimension endpoint. See
// docs/DECISIONS.md #13 for why noul dimensions are sent as two-label
// choice dimensions ("yes"/"no") rather than a native noul call: the
// endpoint classifier.dev actually documents (POST /v1/classify with
// `dimensions`) only returns label + confidence + scores per dimension,
// there is no separate bare-probability primitive exposed over this HTTP
// surface. `scores["yes"]` is used as the probability.

import { sleep } from "./lib/concurrency.js";
import type { DimensionDef } from "./dimensions.js";

const ENDPOINT = "https://classifier.dev/v1/classify";
const MAX_ATTEMPTS = 5;

export interface RawDimensionAnswer {
  label?: string;
  confidence?: number | null;
  scores?: Record<string, number> | null;
  model?: string;
  ms?: number;
}

export interface ClassifyChunkResult {
  results: Array<{ dimensions: Record<string, RawDimensionAnswer> }>;
  rateLimitRemaining: number | null;
}

function dimensionPayload(dim: DimensionDef): { labels: string[]; instructions: string } {
  if (dim.kind === "noul") {
    return { labels: ["yes", "no"], instructions: dim.instructions };
  }
  return { labels: dim.labels!, instructions: dim.instructions };
}

export function buildDimensionsPayload(dims: DimensionDef[]): Record<string, { labels: string[]; instructions: string }> {
  const payload: Record<string, { labels: string[]; instructions: string }> = {};
  for (const dim of dims) {
    payload[dim.key] = dimensionPayload(dim);
  }
  return payload;
}

export class ClassifyBatchUnavailableError extends Error {}

// Sends one chunk (items x dimensions must be <= 1000 decisions, enforced
// by the caller). Retries on 429 (honouring Retry-After) and on 502 codes
// that are documented as retryable (typesafe_*, chain_exhausted, timeout,
// batch_unavailable), with exponential backoff. Never retries a 400: that
// means the request itself is malformed and retrying won't fix it.
export async function classifyChunk(
  items: string[],
  dims: DimensionDef[],
): Promise<ClassifyChunkResult> {
  const body = JSON.stringify({
    items,
    dimensions: buildDimensionsPayload(dims),
    tier: "fast",
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const rateLimitRemainingHeader = res.headers.get("ratelimit-remaining");
    const rateLimitRemaining = rateLimitRemainingHeader ? Number(rateLimitRemainingHeader) : null;

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`classifier.dev rate limited, exhausted ${MAX_ATTEMPTS} retries`);
      }
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status === 502) {
      const errBody = await res.json().catch(() => ({}) as { code?: string });
      if (attempt >= MAX_ATTEMPTS) {
        throw new ClassifyBatchUnavailableError(
          `classifier.dev 502 (${(errBody as { code?: string }).code ?? "unknown"}), exhausted ${MAX_ATTEMPTS} retries`,
        );
      }
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`classifier.dev HTTP ${res.status}: ${errBody}`);
    }

    const json = (await res.json()) as { results: Array<{ dimensions: Record<string, RawDimensionAnswer> }> };
    return { results: json.results, rateLimitRemaining };
  }

  throw new Error("classifyChunk: unreachable");
}
