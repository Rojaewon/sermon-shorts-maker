import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { outPath } from "@/lib/storage";

export const runtime = "nodejs";

// Keep it a plain filename: no path separators, no traversal, .mp4 suffix.
// Hangul stays — the whole point is a name the user recognises in Downloads.
// Built with RegExp so the control-character range survives editing intact.
const FILENAME_UNSAFE = new RegExp('[\\\\/:*?"<>|\\u0000-\\u001f]', "g");

function sanitizeDownloadName(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(FILENAME_UNSAFE, "")
    .split("..")
    .join("")
    .trim()
    .slice(0, 80);
  if (!cleaned) return null;
  return cleaned.toLowerCase().endsWith(".mp4") ? cleaned : `${cleaned}.mp4`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const safe = name.replace(/[^\w.\-]/g, "");
  const p = outPath(safe);
  if (!fs.existsSync(p)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const stat = fs.statSync(p);
  const range = req.headers.get("range");
  const download = req.nextUrl.searchParams.get("download");
  // On disk a render is named by a style hash, which tells the user nothing in
  // their Downloads folder. "as" lets the caller ask for the sermon title
  // instead; only the download name changes, never the file — the render cache
  // is keyed on that hash.
  const asName = sanitizeDownloadName(req.nextUrl.searchParams.get("as")) || safe;
  const dispo = download
    ? `attachment; filename*=UTF-8''${encodeURIComponent(asName)}`
    : "inline";

  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : stat.size - 1;
      const chunk = fs.createReadStream(p, { start, end });
      return new NextResponse(chunk as unknown as ReadableStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          "Content-Type": "video/mp4",
          "Content-Disposition": dispo,
        },
      });
    }
  }

  const stream = fs.createReadStream(p);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Length": String(stat.size),
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Disposition": dispo,
    },
  });
}
