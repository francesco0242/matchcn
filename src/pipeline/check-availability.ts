// Per-item install availability check. Not a classifier.dev cost at all,
// this is plain HTTP against each tagged component's own sourceUrl (the
// same URL `npx shadcn add` would fetch). Exists because the shadcnblocks
// and shadcn-dashboard paywall (some items 401/403 unauthenticated,
// "License required" / "pro blocks") is invisible in the registry.json
// index itself: a paywalled item and a free item have an identical raw
// shape, no tier/pro/license field anywhere (confirmed by direct
// comparison during the incident that prompted this script). The only
// real signal is the actual fetch status code.
//
// Usage: tsx src/pipeline/check-availability.ts --registry=shadcnblocks
//        tsx src/pipeline/check-availability.ts --registry=shadcnblocks --registry=shadcn-dashboard
//
// Writes:
//   .cache/availability/<registry>/<safe-name>.json   one cached result per component, rerunnable for free
//   data/tags-raw/<registry>.json                     full tagged output, unfiltered, never overwritten by a fail
//   data/tags/<registry>.json                          filtered to available (2xx) components only; this is what ships and what pick_component reads

import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readJsonCache, writeJsonCache } from "../runtime/lib/cache.js";
import { pLimit, sleep } from "../runtime/lib/concurrency.js";
import type { TagRecord } from "../runtime/types.js";

const CACHE_DIR = ".cache/availability";
const RAW_DIR = join("data", "tags-raw");
const SHIP_DIR = join("data", "tags");
const CONCURRENCY = 2;
const TIMEOUT_MS = 15_000;
const MAX_429_ATTEMPTS = 5;
const MAX_429_SLEEP_MS = 20_000;

interface AvailabilityResult {
  ok: boolean;
  status: number;
  checkedVia: "HEAD" | "GET";
  reason?: string;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// A definitive auth-gate response (401/403) is trusted straight away; no
// reason to spend a second request confirming what the server already
// stated plainly. HEAD-unsupported responses (405, 501) fall back to GET,
// since some servers simply do not implement HEAD and that is not
// evidence of anything about availability. A 429 is a rate limit, not an
// availability answer at all: retried with backoff (honoring Retry-After
// when present, capped), never treated as a fail. A tight concurrent
// bulk check against a single small vendor's server is exactly the kind
// of load that triggers this, confirmed directly (2,091 of shadcnblocks'
// 4,171 items came back 429 on the first run at 8-concurrent, before this
// retry logic existed, which would have wrongly dropped all of them from
// the shipping catalog as if they were paywalled).
async function requestWithRetry(url: string, method: "HEAD" | "GET"): Promise<Response | null> {
  for (let attempt = 1; attempt <= MAX_429_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      return null;
    }
    if (res.status !== 429) return res;
    if (attempt >= MAX_429_ATTEMPTS) return res;
    const retryAfterMs = (Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000;
    await sleep(Math.min(retryAfterMs, MAX_429_SLEEP_MS));
  }
  return null;
}

async function checkOne(url: string): Promise<AvailabilityResult> {
  const headRes = await requestWithRetry(url, "HEAD");
  if (headRes) {
    if (headRes.status === 401 || headRes.status === 403) {
      return { ok: false, status: headRes.status, checkedVia: "HEAD", reason: "auth-gated" };
    }
    if (headRes.status === 200) {
      return { ok: true, status: 200, checkedVia: "HEAD" };
    }
    if (headRes.status === 429) {
      return { ok: false, status: 429, checkedVia: "HEAD", reason: "rate-limited-exhausted-retries" };
    }
    if (headRes.status !== 405 && headRes.status !== 501) {
      return { ok: false, status: headRes.status, checkedVia: "HEAD", reason: `unexpected-status-${headRes.status}` };
    }
    // fall through to GET on 405/501 (HEAD not supported)
  }

  const getRes = await requestWithRetry(url, "GET");
  if (!getRes) {
    return { ok: false, status: 0, checkedVia: "GET", reason: "network-error" };
  }
  if (getRes.status === 401 || getRes.status === 403) {
    return { ok: false, status: getRes.status, checkedVia: "GET", reason: "auth-gated" };
  }
  if (getRes.status === 429) {
    return { ok: false, status: 429, checkedVia: "GET", reason: "rate-limited-exhausted-retries" };
  }
  return { ok: getRes.status === 200, status: getRes.status, checkedVia: "GET", reason: getRes.status === 200 ? undefined : `unexpected-status-${getRes.status}` };
}

async function checkCached(registry: string, record: TagRecord): Promise<AvailabilityResult> {
  const cachePath = join(CACHE_DIR, registry, `${safeName(record.name)}.json`);
  const cached = await readJsonCache<AvailabilityResult>(cachePath);
  if (cached) return cached;
  const result = await checkOne(record.sourceUrl);
  await writeJsonCache(cachePath, result);
  return result;
}

async function checkRegistry(registry: string): Promise<void> {
  const path = join(SHIP_DIR, `${registry}.json`);
  const records = await readJsonCache<TagRecord[]>(path);
  if (!records) {
    console.error(`No data/tags/${registry}.json found. Nothing to check.`);
    return;
  }

  const limit = pLimit(CONCURRENCY);
  const results: Array<{ record: TagRecord; result: AvailabilityResult }> = await Promise.all(
    records.map((record) => limit(async () => ({ record, result: await checkCached(registry, record) }))),
  );

  const available = results.filter((r) => r.result.ok);
  const gated = results.filter((r) => !r.result.ok && r.result.reason === "auth-gated");
  const otherFail = results.filter((r) => !r.result.ok && r.result.reason !== "auth-gated");

  // Preserve the full, unfiltered tagged output. Never overwritten once
  // written: this is real classifier.dev spend, and a component gated
  // today could become free again later (see ROADMAP.md), at which point
  // re-running this script picks it back up without re-tagging.
  const rawPath = join(RAW_DIR, `${registry}.json`);
  const existingRaw = await readJsonCache<TagRecord[]>(rawPath);
  if (!existingRaw) {
    await mkdir(RAW_DIR, { recursive: true });
    await writeFile(rawPath, JSON.stringify(records, null, 2), "utf8");
  }

  // Ship only what actually installs.
  await writeJsonCache(path, available.map((r) => r.record));

  console.log(`\n=== ${registry} ===`);
  console.log(`  total tagged: ${records.length}`);
  console.log(`  available (ships): ${available.length}`);
  console.log(`  auth-gated (dropped): ${gated.length}`);
  if (otherFail.length > 0) {
    console.log(`  other failure (dropped, investigate separately): ${otherFail.length}`);
    for (const f of otherFail.slice(0, 10)) {
      console.log(`    ${f.record.name}: ${f.result.status} ${f.result.reason}`);
    }
  }
}

async function main() {
  const registries = process.argv.filter((a) => a.startsWith("--registry=")).map((a) => a.split("=")[1]);
  const targets = registries.length > 0 ? registries : ["shadcnblocks", "shadcn-dashboard"];
  for (const registry of targets) {
    await checkRegistry(registry);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
