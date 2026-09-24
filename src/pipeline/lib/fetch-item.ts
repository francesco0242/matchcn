import { readJsonCache, writeJsonCache } from "../../runtime/lib/cache.js";
import { sleep } from "../../runtime/lib/concurrency.js";

export interface FetchItemResult {
  ok: boolean;
  data?: unknown;
  reason?: string; // set when ok is false, e.g. "bot-challenge", "non-json", "404"
  fromCache?: boolean;
}

const MAX_ATTEMPTS = 3;

// Fetches one per-item registry JSON (the {name}.json URL from
// registries.json), caching the raw response to disk so a rerun costs
// nothing. Never throws: a bot challenge, a non-JSON body, or a persistent
// 429/5xx comes back as { ok: false, reason }, per docs/DECISIONS.md #12
// (cult-ui already showed this failure mode is real, not hypothetical).
export async function fetchItemJson(url: string, cachePath: string): Promise<FetchItemResult> {
  const cached = await readJsonCache<{ ok: boolean; data?: unknown; reason?: string }>(cachePath);
  if (cached) {
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
