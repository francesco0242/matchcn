import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

// `strict: true` distinguishes "no file yet" (ENOENT -- a legitimate,
// silent null, e.g. a first run) from "file exists but failed to parse"
// (corrupted/truncated/hand-edited -- rethrown instead of silently
// returning null). Callers that would otherwise treat "corrupted" the
// same as "empty" and then overwrite the file with just newly-computed
// data, permanently losing whatever the corrupted file held, should pass
// this. Defaults to false (both cases return null) to keep every existing
// caller's resilient-by-default behavior unchanged.
export async function readJsonCache<T>(path: string, opts?: { strict?: boolean }): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if (opts?.strict && (err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
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
