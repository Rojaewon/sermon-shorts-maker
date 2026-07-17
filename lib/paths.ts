// Where things live, in dev vs. inside a packaged desktop app.
//
// Packaged, the install dir is READ-ONLY (Program Files) and app code is inside
// an asar archive that external processes like ffmpeg cannot read. So Electron's
// main process passes real, writable/readable paths in via env vars, and every
// path in the app resolves through here. In dev nothing sets them and we fall
// back to the repo layout, so `npm run dev` behaves exactly as before.

import path from "node:path";

// Writable: caches, rendered output, the downloaded yt-dlp binary.
// Packaged -> Electron's userData dir.
export function dataRoot(): string {
  return process.env.SHORTS_DATA_DIR || path.join(process.cwd(), ".data");
}

export function binRoot(): string {
  return process.env.SHORTS_BIN_DIR || path.join(process.cwd(), "bin");
}

// Read-only resources that external processes must reach: fonts (ffmpeg reads
// these) and the ffmpeg binary itself. Packaged -> unpacked resources, not asar.
export function fontsDir(): string {
  return process.env.SHORTS_FONTS_DIR || path.join(process.cwd(), "assets", "fonts");
}

// ffmpeg-static resolves to a path inside app.asar once packaged, which cannot
// be executed. Electron main passes the unpacked location instead.
export function ffmpegPath(fallback: string): string {
  return process.env.SHORTS_FFMPEG || fallback;
}

export const isPackaged = !!process.env.SHORTS_DATA_DIR;
