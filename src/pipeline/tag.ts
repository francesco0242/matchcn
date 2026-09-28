// CLI entry for Stage 2 (Tag). Requires src/ingest.ts to have run first
// (reads .cache/normalized/<registry>.json). Writes data/tags/<registry>.json,
// checkpointed and resumable.
//
// Usage:
//   tsx src/tag.ts                        tag everything not yet tagged
//   tsx src/tag.ts --registry=magicui      tag only one registry
//   tsx src/tag.ts --limit=50              tag at most 50 new components (per registry)

import { join } from "node:path";
import { REGISTRIES } from "../runtime/registries.js";
import { readJsonCache } from "../runtime/lib/cache.js";
import { runTagging } from "./tagger.js";
import type { NormalizedComponent } from "../runtime/types.js";

interface Checkpoint {
  taggedNames: string[];
  decisionsSpent: number;
  lastRateLimitRemaining: number | null;
  lastRateLimitObservedAtMs: number | null;
  updatedAt: string;
}

const CACHE_DIR = ".cache";
const OUTPUT_DIR = join("data", "tags");

function parseArgs() {
  const registryArg = process.argv.find((a) => a.startsWith("--registry="))?.split("=")[1];
  const limitArg = process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
  return {
    registry: registryArg,
    limit: limitArg ? Number(limitArg) : undefined,
  };
}

// tagger.ts's runTagging catches ClassifyQuotaExhaustedError internally
// (classifyErrorOutcome always recognizes it, so its `throw err` fallback
// is never reached for this error type) and reports it via
// summary.stoppedForQuota instead of rethrowing. A prior version of this
// file had a `main().catch` branch for ClassifyQuotaExhaustedError that
// could therefore never run -- the real check has to happen here, right
// after runTagging returns, not in a catch block.
async function reportQuotaExhaustionAndExit(registry: string): Promise<never> {
  console.error(`\nSTOPPED: quota exhausted while tagging "${registry}".`);
  const checkpoint = await readJsonCache<Checkpoint>(join(CACHE_DIR, `tag-checkpoint-${registry}.json`));
  if (checkpoint) {
    console.error(
      `[${registry}] resume point: ${checkpoint.taggedNames.length} component(s) already tagged and checkpointed, ` +
        `${checkpoint.decisionsSpent} decisions spent in "${registry}" so far. ` +
        `Rerun the identical command after switching networks; already-tagged components are skipped automatically.`,
    );
  }
  process.exit(2); // distinct from the generic-crash exit(1) below
}

async function main() {
  const { registry, limit } = parseArgs();
  const targets = registry ? REGISTRIES.filter((r) => r.name === registry) : REGISTRIES;
  if (targets.length === 0) {
    console.error(`Unknown registry "${registry}"`);
    process.exit(1);
  }

  let processedCount = 0;

  for (const target of targets) {
    const components = await readJsonCache<NormalizedComponent[]>(
      join(CACHE_DIR, "normalized", `${target.name}.json`),
    );
    if (!components) {
      console.error(`No normalized data for ${target.name}. Run "pnpm ingest" first.`);
      continue;
    }

    const summary = await runTagging({
      registry: target.name,
      components,
      outputPath: join(OUTPUT_DIR, `${target.name}.json`),
      checkpointDir: CACHE_DIR,
      limit,
    });
    processedCount++;

    console.log(
      `[${summary.registry}] attempted=${summary.attempted} tagged=${summary.tagged} ` +
        `alreadyTagged=${summary.skippedAlreadyTagged} decisionsSpent=${summary.decisionsSpent} ` +
        `chunksSent=${summary.chunksSent} rateLimitRemaining=${summary.rateLimitRemaining} ` +
        `stoppedForQuota=${summary.stoppedForQuota}`,
    );

    // Must stop here, not just log and move on: continuing to the next
    // registry against an already-exhausted quota means every remaining
    // registry redundantly repeats the same multi-minute 429 retry-and-
    // backoff cycle in tagger.ts for nothing, and the run would still
    // exit 0 at the end -- the same class of CI-invisible failure as the
    // "nothing tagged" case below, just for quota exhaustion instead.
    if (summary.stoppedForQuota) {
      await reportQuotaExhaustionAndExit(target.name);
    }
  }

  // Every target was missing normalized data (most likely: pnpm ingest
  // was never run) -- a CI job or orchestration script checking the exit
  // code must not see this as success just because nothing threw.
  if (processedCount === 0) {
    console.error(`\nNothing tagged: no target had normalized data. Run "pnpm ingest" first.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
