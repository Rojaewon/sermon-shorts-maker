// Resolves paths to ffmpeg / yt-dlp binaries.
// ffmpeg-static ships a prebuilt binary; yt-dlp is downloaded on first use.
// All locations go through lib/paths so the packaged desktop app can redirect
// them out of the read-only install dir / asar archive.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ffmpegStaticPath from "ffmpeg-static";
import YTDlpWrapNs from "yt-dlp-wrap";
import { binRoot, fontsDir, ffmpegPath } from "./paths";

// CJS/ESM interop: the class is exported as .default under ESM, but is the
// module itself under some bundlers. Resolve robustly.
const YTDlpWrap: typeof YTDlpWrapNs =
  (YTDlpWrapNs as unknown as { default?: typeof YTDlpWrapNs }).default ?? YTDlpWrapNs;

export const FFMPEG: string = ffmpegPath(ffmpegStaticPath as unknown as string);

// YouTube keeps changing how it serves video, and yt-dlp ships fixes within
// days. A copy that is a couple of months old simply stops working — so for a
// desktop app that users install once and never think about again, refreshing
// this binary is the single most important piece of maintenance. Without it
// every installed copy breaks at roughly the same time, and nobody knows why.
const UPDATE_EVERY_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

let ytdlpReady: Promise<any> | null = null;

function stampFile(dir: string) {
  return path.join(dir, "yt-dlp.updated.json");
}

function lastUpdated(dir: string): number {
  try {
    return JSON.parse(fs.readFileSync(stampFile(dir), "utf8")).updatedAt ?? 0;
  } catch {
    return 0;
  }
}

function markUpdated(dir: string) {
  try {
    fs.writeFileSync(stampFile(dir), JSON.stringify({ updatedAt: Date.now() }));
  } catch {
    /* a failed stamp only means we re-check sooner */
  }
}

export async function getYtDlp(): Promise<any> {
  if (!ytdlpReady) {
    ytdlpReady = (async () => {
      const dir = binRoot();
      const exe = path.join(dir, os.platform() === "win32" ? "yt-dlp.exe" : "yt-dlp");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // First run: we cannot proceed without it, so let failures surface.
      if (!fs.existsSync(exe)) {
        await YTDlpWrap.downloadFromGithub(exe);
        markUpdated(dir);
        return new YTDlpWrap(exe);
      }

      // Refresh: download beside the old copy and only swap on success, so a
      // half-finished download can never leave the user with a broken binary.
      // Offline or GitHub down? Keep using what we have — an old yt-dlp is far
      // better than a dead app.
      if (Date.now() - lastUpdated(dir) > UPDATE_EVERY_MS) {
        const next = `${exe}.new`;
        try {
          fs.rmSync(next, { force: true });
          await YTDlpWrap.downloadFromGithub(next);
          if (fs.statSync(next).size > 1_000_000) {
            fs.rmSync(exe, { force: true });
            fs.renameSync(next, exe);
            markUpdated(dir);
          } else {
            fs.rmSync(next, { force: true }); // implausibly small — reject it
          }
        } catch {
          fs.rmSync(next, { force: true });
          // Stamp anyway: don't retry a failing download on every single run.
          markUpdated(dir);
        }
      }
      return new YTDlpWrap(exe);
    })();
  }
  return ytdlpReady;
}

// Font dir passed to ffmpeg's subtitles filter (fontsdir).
// Family names are read from the TTF name tables (verified):
//   Pretendard-Bold.ttf      -> family "Pretendard"
//   Pretendard-ExtraBold.ttf -> family "Pretendard ExtraBold"
export const FONTS_DIR: string = fontsDir();
export const TITLE_FONT_NAME = "Pretendard ExtraBold"; // heavy weight for titles
export const SUB_FONT_NAME = "Pretendard"; // bold weight for subtitles
