// Text to paste into YouTube's upload form.
//
// Uploading through the API is not an option today: videos inserted by a
// project that hasn't passed Google's compliance audit are locked private with
// no appeal, so they could never be published. Until that audit clears, the app
// prepares everything and the last paste stays manual.

import type { Highlight } from "./types";

export interface UploadMeta {
  title: string;
  description: string;
  fileName: string;
}

// Windows forbids \ / : * ? " < > | in filenames, and a trailing dot or space
// makes a file awkward to open. Keep Hangul — the point is a name the user can
// recognise in their Downloads folder.
function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  const base = cleaned.slice(0, 60) || "설교쇼츠";
  return `${base}.mp4`;
}

export function buildUploadMeta(
  h: Highlight,
  opts: { churchName?: string; sourceUrl?: string } = {},
): UploadMeta {
  const title = `${h.titleLine1 ?? ""} ${h.titleLine2 ?? ""}`.replace(/\s+/g, " ").trim();

  const lines: string[] = [];
  if (h.summary?.trim()) lines.push(h.summary.trim(), "");
  if (opts.churchName?.trim()) lines.push(opts.churchName.trim());
  if (opts.sourceUrl?.trim()) lines.push(`전체 설교 보기: ${opts.sourceUrl.trim()}`);
  if (lines.length) lines.push("");
  // Not required for Shorts classification — YouTube decides that from the
  // 9:16 ratio and sub-3-minute length, which these clips already satisfy —
  // but it still helps the video surface in search.
  lines.push("#Shorts #설교 #말씀");

  return {
    title,
    // Collapse runs of blank lines — with no church name or source link the
    // optional rows leave gaps behind.
    description: lines.join("\n").split(/\n{3,}/).join("\n\n").trim(),
    fileName: safeFileName(title),
  };
}
