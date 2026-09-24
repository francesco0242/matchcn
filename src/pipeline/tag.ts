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
import { ClassifyQuotaExhaustedError } from "../runtime/classify.js";
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

async function main() {
  const { registry, limit } = parseArgs();
  const targets = registry ? REGISTRIES.filter((r) => r.name === registry) : REGISTRIES;
  if (targets.length === 0) {
    console.error(`Unknown registry "${registry}"`);
    process.exit(1);
  }

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

    console.log(
      `[${summary.registry}] attempted=${summary.attempted} tagged=${summary.tagged} ` +
        `alreadyTagged=${summary.skippedAlreadyTagged} decisionsSpent=${summary.decisionsSpent} ` +
        `chunksSent=${summary.chunksSent} rateLimitRemaining=${summary.rateLimitRemaining} ` +
        `stoppedForQuota=${summary.stoppedForQuota}`,
    );
  }
}

main().catch(async (err) => {
  if (err instanceof ClassifyQuotaExhaustedError) {
    // Stop cleanly, no stack trace, no further retries: every chunk before
    // this one already checkpointed to disk, so rerunning the identical
    // command later resumes from exactly here (componentKey-based dedup in
    // tagger.ts skips everything already tagged). Read the checkpoint back
    // to report the real resume point instead of guessing from summary
    // state, since the failure happened inside runTagging before it could
    // return one.
    const { registry } = parseArgs();
    console.error(`\nSTOPPED: quota exhausted. ${err.message}`);
    if (registry) {
      const checkpoint = await readJsonCache<Checkpoint>(join(CACHE_DIR, `tag-checkpoint-${registry}.json`));
      if (checkpoint) {
        console.error(
          `[${registry}] resume point: ${checkpoint.taggedNames.length} component(s) already tagged and checkpointed, ` +
            `${checkpoint.decisionsSpent} decisions spent in "${registry}" so far. ` +
            `Rerun the identical command after switching networks; already-tagged components are skipped automatically.`,
        );
      }
    }
    process.exit(2); // distinct from the generic-crash exit(1) below
  }
  console.error(err);
  process.exit(1);
});
