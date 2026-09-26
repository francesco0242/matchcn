import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function readJsonCache<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Writes via a temp file + rename rather than a direct writeFile, so a
// process killed mid-write leaves the previous version intact instead of
// a truncated/corrupt file at `path` (rename is atomic on the same
// filesystem, which the temp file always is since it's written next to
// the target). See docs/DECISIONS.md for the checkpoint/output write
// ordering this also matters for: tagger.ts relies on `path` never being
// observed half-written.
export async function writeJsonCache(path: string, data: unknown): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.${randomUUID()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, path);
}
