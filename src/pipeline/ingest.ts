// Stage 1 (Ingest) + Filter, per docs/ARCHITECTURE.md and
// docs/FILTER_REPORT.md. Fetches each registry's index, applies the
// deterministic filter, enriches thin-metadata components with inline
// source from the per-item JSON (docs/DECISIONS.md #11), and writes one
// normalized record file per registry to .cache/normalized/ (gitignored;
// this is intermediate data, not the committed output).

import { join } from "node:path";
import { RawRegistryIndexSchema, type NormalizedComponent, type RawRegistryItem } from "../runtime/types.js";
import { REGISTRIES, type RegistryConfig } from "../runtime/registries.js";
import { applyFilter, type FilterDropped } from "./filter.js";
import { enrichThinComponents, type EnrichCandidate } from "./enrich.js";
import { readJsonCache, writeJsonCache } from "../runtime/lib/cache.js";
import { baseText } from "./lib/base-text.js";

const CACHE_DIR = ".cache";

async function fetchIndex(registry: RegistryConfig): Promise<RawRegistryItem[]> {
  const cachePath = join(CACHE_DIR, "index", `${registry.name}.json`);
  const cached = await readJsonCache<{ items: RawRegistryItem[] }>(cachePath);
  if (cached) return cached.items;

  const res = await fetch(registry.indexUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Failed to fetch index for ${registry.name}: HTTP ${res.status} at ${registry.indexUrl}`);
  }
  const json = RawRegistryIndexSchema.parse(await res.json());
  await writeJsonCache(cachePath, { items: json.items });
  return json.items;
}

async function ingestRegistry(registry: RegistryConfig): Promise<{
  normalized: NormalizedComponent[];
  dropped: FilterDropped[];
}> {
  const rawItems = await fetchIndex(registry);
  const { kept, dropped } = applyFilter(registry.name, rawItems);

  const candidates: EnrichCandidate[] = kept.map((k) => ({
    name: k.item.name,
    title: k.item.title ?? null,
    description: k.item.description ?? null,
  }));
  const enrichResults = await enrichThinComponents(registry, candidates, CACHE_DIR);

  const fetchedAt = new Date().toISOString();
  const normalized: NormalizedComponent[] = kept.map(({ item, compositionLevel, variants }) => {
    const title = item.title ?? null;
    const description = item.description ?? null;
    const enrich = enrichResults.get(item.name);
    const taggingText = enrich?.taggingText ?? baseText(title, description, item.name);

    return {
      registry: registry.name,
      name: item.name,
      title,
      description,
      rawType: item.type,
      compositionLevel,
      filePaths: (item.files ?? []).map((f) => f.path ?? f.target ?? "").filter(Boolean),
      dependencies: item.dependencies ?? [],
      sourceUrl: registry.itemUrlTemplate.replace("{name}", item.name),
      fetchedAt,
      variants,
      enrichedFromSource: enrich?.enriched ?? false,
      taggingText,
    };
  });

  return { normalized, dropped };
}

async function main() {
  const registryFilter = process.argv.find((a) => a.startsWith("--registry="))?.split("=")[1];
  const targets = registryFilter ? REGISTRIES.filter((r) => r.name === registryFilter) : REGISTRIES;

  // One registry's transient failure (a flaky index endpoint, a
  // momentary 5xx -- fetchIndex has no retry of its own) must not abort
  // every registry after it in iteration order; each is independent, with
  // no shared state. Failures are collected and reported at the end,
  // still exiting non-zero so CI/automation notices, but every other
  // registry gets its .cache/normalized/*.json written regardless.
  const failed: string[] = [];

  for (const registry of targets) {
    process.stdout.write(`Ingesting ${registry.name}...\n`);
    try {
      const { normalized, dropped } = await ingestRegistry(registry);
      const enrichedCount = normalized.filter((n) => n.enrichedFromSource).length;
      await writeJsonCache(join(CACHE_DIR, "normalized", `${registry.name}.json`), normalized);
      process.stdout.write(
        `  ${normalized.length} kept, ${dropped.length} dropped, ${enrichedCount} enriched from source\n`,
      );
    } catch (err) {
      failed.push(registry.name);
      // Logged with console.error (full object, stack included), not
      // just the message: a genuine programming bug deep in
      // ingestRegistry deserves the same loud, stack-traced visibility
      // it had before this per-registry isolation existed, not a
      // one-line message indistinguishable from an expected network
      // blip.
      process.stderr.write(`  FAILED: ${registry.name}\n`);
      console.error(err);
    }
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length}/${targets.length} registries failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
