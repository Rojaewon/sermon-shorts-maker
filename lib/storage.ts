// File storage abstraction. Local-disk adapter for now; swap for S3 etc. later.
// Dev: ./.data (gitignored). Packaged desktop app: Electron's userData dir,
// because the install dir is read-only. See lib/paths.

import fs from "node:fs";
import path from "node:path";
import { dataRoot } from "./paths";

const DATA_DIR = dataRoot();
const CACHE_DIR = path.join(DATA_DIR, "cache"); // source video downloads, keyed by videoId
const OUT_DIR = path.join(DATA_DIR, "out"); // rendered shorts
const TMP_DIR = path.join(DATA_DIR, "tmp"); // scratch (subs, clips)

for (const d of [DATA_DIR, CACHE_DIR, OUT_DIR, TMP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

export function cachePath(name: string): string {
  return path.join(CACHE_DIR, name);
}
export function outPath(name: string): string {
  return path.join(OUT_DIR, name);
}
export function tmpPath(name: string): string {
  return path.join(TMP_DIR, name);
}

export function outUrl(name: string): string {
  return `/api/files/${encodeURIComponent(name)}`;
}

export function readOut(name: string): Buffer | null {
  const p = outPath(name);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

export { CACHE_DIR, OUT_DIR, TMP_DIR };
