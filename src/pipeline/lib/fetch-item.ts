import { readJsonCache, writeJsonCache } from "../../runtime/lib/cache.js";
import { sleep } from "../../runtime/lib/concurrency.js";

export interface FetchItemResult {
  ok: boolean;
  data?: unknown;
  reason?: string; // set when ok is false, e.g. "bot-challenge", "non-json", "404"
  fromCache?: boolean;
}

const MAX_ATTEMPTS = 3;

// Failure reasons that describe a one-off condition (a network blip, a
// momentary 5xx, exhausting retries on transient rate-limiting or a
// malformed body that could easily be a fluke) rather than something the
// vendor is doing deliberately and permanently (401/403/404, a bot
// challenge, a persistently non-JSON endpoint). Caching a transient
// failure forever contradicts docs/ARCHITECTURE.md's claim that "Ingest
// is idempotent: re-running it just refreshes the cache" -- without this,
// a single momentary blip during one ingest run permanently poisons that
// item's cache entry, degrading it to un-enriched tagging input on every
// future run until someone manually deletes the cache file
// (GitHub issue #25). Permanent failures are still cached indefinitely,
// same as before, since retrying those wastes a request for no benefit.
const TRANSIENT_FAILURE_PREFIXES = ["network-error", "rate-limited-exhausted-retries", "server-error-", "json-parse-error", "exhausted-retries"];

function isTransientFailure(reason: string | undefined): boolean {
  if (!reason) return false;
  return TRANSIENT_FAILURE_PREFIXES.some((prefix) => reason.startsWith(prefix));
}

// Fetches one per-item registry JSON (the {name}.json URL from
// registries.json), caching the raw response to disk so a rerun costs
// nothing. Never throws: a bot challenge, a non-JSON body, or a persistent
// 429/5xx comes back as { ok: false, reason }, per docs/DECISIONS.md #12
// (cult-ui already showed this failure mode is real, not hypothetical).
export async function fetchItemJson(url: string, cachePath: string): Promise<FetchItemResult> {
  const cached = await readJsonCache<{ ok: boolean; data?: unknown; reason?: string }>(cachePath);
  if (cached && !(cached.ok === false && isTransientFailure(cached.reason))) {
    return { ...cached, fromCache: true };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      const result: FetchItemResult = { ok: false, reason: `network-error: ${String(err)}` };
      await writeJsonCache(cachePath, result);
      return result;
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(retryAfter * 1000);
        continue;
      }
      const result: FetchItemResult = { ok: false, reason: "rate-limited-exhausted-retries" };
      await writeJsonCache(cachePath, result);
      return result;
    }

    if (res.status >= 500) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      const result: FetchItemResult = { ok: false, reason: `server-error-${res.status}` };
      await writeJsonCache(cachePath, result);
      return result;
    }

    if (!res.ok) {
      const result: FetchItemResult = { ok: false, reason: `http-${res.status}` };
      await writeJsonCache(cachePath, result);
      return result;
    }

    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();

    if (!contentType.includes("application/json")) {
      // A bot-challenge page or an HTML fallback both land here (see
      // cult-ui in docs/DECISIONS.md #6). Skip cleanly, do not crash.
      const looksLikeChallenge = /vercel security checkpoint|cf-challenge|captcha/i.test(body);
      const result: FetchItemResult = {
        ok: false,
        reason: looksLikeChallenge ? "bot-challenge" : "non-json-response",
      };
      await writeJsonCache(cachePath, result);
      return result;
    }

    try {
      const data = JSON.parse(body);
      const result: FetchItemResult = { ok: true, data };
      await writeJsonCache(cachePath, result);
      return result;
    } catch {
      const result: FetchItemResult = { ok: false, reason: "json-parse-error" };
      await writeJsonCache(cachePath, result);
      return result;
    }
  }

  const result: FetchItemResult = { ok: false, reason: "exhausted-retries" };
  await writeJsonCache(cachePath, result);
  return result;
}
