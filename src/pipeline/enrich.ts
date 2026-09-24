// Fetches per-item registry JSON for components whose index description is
// missing or too thin to tag well, and extracts source as extra tagging
// signal. See docs/DECISIONS.md #11 for why this exists (aceternity's 112
// undescribed registry:ui primitives) and RECON.md's per-item fetch check
// confirming shadcn's per-item JSON inlines full file content, unlike the
// batch index.
//
// This does NOT pull from GitHub. It only fetches the same per-item JSON
// URL shadcn's own CLI uses to install a component (registries.json's
// {name}.json template), which for every registry checked so far inlines
// the file content directly in the response.

import { join } from "node:path";
import { fetchItemJson } from "./lib/fetch-item.js";
import { pLimit } from "../runtime/lib/concurrency.js";
import type { RegistryConfig } from "../runtime/registries.js";

const THIN_DESCRIPTION_CHARS = 40;
const MAX_CONCURRENT = 4;
const SOURCE_TRUNCATE_CHARS = 8000; // keeps well under the 32,000 input cap

export interface EnrichCandidate {
  name: string;
  title: string | null;
  description: string | null;
}

export interface EnrichResult {
  name: string;
  enriched: boolean;
  taggingText: string;
  reason?: string; // set when enrichment was attempted but failed
}

// Same name-fallback rule as ingest.ts's baseText: never return empty text.
function baseText(title: string | null, description: string | null, name: string): string {
  const text = [title, description].filter(Boolean).join(". ");
  return text || name;
}

function needsEnrichment(candidate: EnrichCandidate): boolean {
  return baseText(candidate.title, candidate.description, candidate.name).length < THIN_DESCRIPTION_CHARS;
}

// Strips import statements and trims to a length budget, keeping the head
// of the file (props/types/interface declarations and the component body
// normally come before trailing boilerplate) rather than the tail.
function trimSource(content: string): string {
  const withoutImports = content
    .split("\n")
    .filter((line) => !/^\s*import\s/.test(line))
    .join("\n")
    .trim();
  if (withoutImports.length <= SOURCE_TRUNCATE_CHARS) return withoutImports;
  return withoutImports.slice(0, SOURCE_TRUNCATE_CHARS);
}

interface PerItemFile {
  path?: string;
  content?: string;
}
interface PerItemPayload {
  title?: string;
  description?: string;
  files?: PerItemFile[];
}

export async function enrichThinComponents(
  registry: RegistryConfig,
  candidates: EnrichCandidate[],
  cacheDir: string,
): Promise<Map<string, EnrichResult>> {
  const results = new Map<string, EnrichResult>();
  const toEnrich = candidates.filter(needsEnrichment);
  const limit = pLimit(MAX_CONCURRENT);

  await Promise.all(
    toEnrich.map((candidate) =>
      limit(async () => {
        const url = registry.itemUrlTemplate.replace("{name}", encodeURIComponent(candidate.name));
        const cachePath = join(cacheDir, "items", registry.name, `${candidate.name}.json`);
        const fetched = await fetchItemJson(url, cachePath);

        if (!fetched.ok) {
          results.set(candidate.name, {
            name: candidate.name,
            enriched: false,
            taggingText: baseText(candidate.title, candidate.description, candidate.name),
            reason: fetched.reason,
          });
          return;
        }

        const payload = fetched.data as PerItemPayload;
        const sourceParts = (payload.files ?? [])
          .filter((f) => typeof f.content === "string" && f.content.length > 0)
          .map((f) => trimSource(f.content!));

        if (sourceParts.length === 0) {
          results.set(candidate.name, {
            name: candidate.name,
            enriched: false,
            taggingText: baseText(candidate.title, candidate.description, candidate.name),
            reason: "item-json-had-no-inline-content",
          });
          return;
        }

        const combinedSource = sourceParts.join("\n\n").slice(0, SOURCE_TRUNCATE_CHARS);
        const title = candidate.title ?? payload.title ?? null;
        const description = candidate.description ?? payload.description ?? null;
        const text = [baseText(title, description, candidate.name), combinedSource].filter(Boolean).join("\n\n");

        results.set(candidate.name, {
          name: candidate.name,
          enriched: true,
          taggingText: text,
        });
      }),
    ),
  );

  return results;
}
