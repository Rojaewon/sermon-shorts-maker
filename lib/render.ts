// Render one highlight into a 1080x1920 short.
//   1. cut [start,end] from the cached source (accurate seek, re-encode)
//   2. scale to height 960, center-crop width 1080  -> video band
//   3. pad onto 1080x1920 canvas at y=480 with template bg color
//   4. burn ASS (title + subtitles) in one subtitles pass
//
// Layout constants come from layout.ts (measured from sample videos).

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { FFMPEG, FONTS_DIR } from "./binaries";
import { buildAss } from "./ass";
import { TEMPLATES, VIDEO_BAND, CANVAS_W, CANVAS_H } from "./layout";
import { tmpPath, outPath } from "./storage";
import type { Cue, SubtitleOptions, TemplateId, TitleStyle, VideoFit } from "./types";

// ffmpeg's subtitles filter needs an escaped path (Windows drive colons, backslashes).
function escFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

export interface RenderParams {
  sourcePath: string;
  startSec: number;
  endSec: number;
  template: TemplateId;
  titleLine1: string;
  titleLine2: string;
  titleStyle?: TitleStyle;
  churchName?: string;
  cues: Cue[]; // absolute timing; will be shifted to clip-relative
  subtitles: SubtitleOptions;
  fit?: VideoFit; // default "crop"
  outName: string;
  onProgress?: (p: number) => void;
}

export async function renderHighlight(params: RenderParams): Promise<string> {
  const dur = params.endSec - params.startSec;
  const tpl = TEMPLATES[params.template];

  // clip-relative cues
  const relCues: Cue[] = params.cues
    .map((c) => ({
      start: c.start - params.startSec,
      end: c.end - params.startSec,
      text: c.text,
    }))
    .filter((c) => c.end > 0 && c.start < dur);

  // write ASS
  const ass = buildAss({
    template: params.template,
    titleLine1: params.titleLine1,
    titleLine2: params.titleLine2,
    titleStyle: params.titleStyle,
    churchName: params.churchName,
    clipDurationSec: dur,
    cues: relCues,
    subtitles: params.subtitles,
  });
  const assPath = tmpPath(`${params.outName}.ass`);
  fs.writeFileSync(assPath, ass, "utf8");

  const out = outPath(params.outName);
  const bg = tpl.bg.replace("#", "0x");

  // Fit the source into the 1080x960 video band.
  //   crop:    scale to height 960, cut the sides  -> fills the band
  //   contain: fit whole frame inside, pad with bg -> nothing cut (slides/PPT)
  const fitFilter =
    (params.fit ?? "crop") === "contain"
      ? `[0:v]scale=${CANVAS_W}:${VIDEO_BAND.height}:force_original_aspect_ratio=decrease,` +
        `pad=${CANVAS_W}:${VIDEO_BAND.height}:(ow-iw)/2:(oh-ih)/2:color=${bg}[vid]`
      : `[0:v]scale=-2:${VIDEO_BAND.height},crop=${CANVAS_W}:${VIDEO_BAND.height}:(iw-${CANVAS_W})/2:0[vid]`;

  // filtergraph:
  //   [0] -> fit into video band -> [vid]
  //   color bg canvas -> overlay [vid] at y=480 -> subtitles(ASS)
  const filter = [
    fitFilter,
    `color=c=${bg}:s=${CANVAS_W}x${CANVAS_H}:d=${dur.toFixed(3)}[bgc]`,
    `[bgc][vid]overlay=0:${VIDEO_BAND.top}[comp]`,
    `[comp]subtitles='${escFilterPath(assPath)}':fontsdir='${escFilterPath(FONTS_DIR)}'[outv]`,
  ].join(";");

  const args = [
    "-y",
    "-ss",
    params.startSec.toFixed(3),
    "-to",
    params.endSec.toFixed(3),
    "-accurate_seek",
    "-i",
    params.sourcePath,
    "-filter_complex",
    filter,
    "-map",
    "[outv]",
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-shortest",
    out,
  ];

  await runFfmpeg(args, dur, params.onProgress);
  return out;
}

function runFfmpeg(
  args: string[],
  durationSec: number,
  onProgress?: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      if (stderr.length > 100_000) stderr = stderr.slice(-50_000);
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
      if (m && onProgress && durationSec > 0) {
        const t = +m[1] * 3600 + +m[2] * 60 + +m[3];
        onProgress(Math.min(0.99, t / durationSec));
      }
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

export { escFilterPath };
