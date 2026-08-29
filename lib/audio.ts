// Prepare audio for speech-to-text.
//
// The old fallback read the raw .m4a and posted it inline to Gemini. That could
// never have worked: a 31-minute sermon is 29MB (38MB once base64'd) against a
// 20MB request limit, and a full 90-minute service is ~112MB. It went unnoticed
// because the test video had YouTube captions and never took this path.
//
// Two separate limits are in play and both need handling:
//   size   — fixed by re-encoding to 16kHz mono. Speech needs nothing more, and
//            90 minutes drops to roughly 10MB.
//   output — a model cannot emit a 90-minute transcript in one response. That's
//            what silently truncated the user's service at ~49 minutes, leaving
//            the AI picking scenes that didn't exist. Fixed by splitting into
//            chunks and transcribing each.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { FFMPEG } from "./binaries";
import { tmpPath } from "./storage";

// 5 minutes. Ten was too long: transcribing that much Korean speech with
// timestamps takes the model several minutes, and Node's fetch gives up at 5
// (undici's headersTimeout) with an opaque "fetch failed". A non-streaming
// response only sends headers once generation finishes, so that ceiling applies
// to the whole call and cannot be raised from the SDK — the request itself has
// to finish well inside it. Half the audio is roughly half the output tokens.
export const CHUNK_SEC = 300;

export interface AudioChunk {
  file: string;
  offsetSec: number; // where this chunk starts in the original recording
}

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { maxBuffer: 32 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(stderr?.slice(-500) || err.message));
      else resolve(stderr || "");
    });
  });
}

// Re-encode to 16kHz mono mp3 and cut into chunks in a single pass.
export async function prepareSpeechChunks(srcPath: string, videoId: string): Promise<AudioChunk[]> {
  const dir = path.dirname(tmpPath(`spc_${videoId}_000.mp3`));
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`spc_${videoId}`)) fs.rmSync(path.join(dir, f), { force: true });
  }

  const pattern = tmpPath(`spc_${videoId}_%03d.mp3`);
  const listFile = tmpPath(`spc_${videoId}_list.csv`);

  await run([
    "-y",
    "-hide_banner",
    "-i",
    srcPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "32k",
    "-f",
    "segment",
    "-segment_time",
    String(CHUNK_SEC),
    // Each chunk restarts at 0; the real offset comes from the list below.
    "-reset_timestamps",
    "1",
    "-segment_list",
    listFile,
    "-segment_list_type",
    "csv",
    pattern,
  ]);

  // ffmpeg cuts on frame boundaries, so chunks aren't exactly CHUNK_SEC long.
  // Read the offsets it actually used rather than assuming them — guessing here
  // would skew every subtitle in the chunk.
  const chunks: AudioChunk[] = [];
  if (fs.existsSync(listFile)) {
    for (const line of fs.readFileSync(listFile, "utf8").split("\n")) {
      const [name, start] = line.trim().split(",");
      if (!name || start === undefined) continue;
      const file = path.join(dir, path.basename(name));
      if (fs.existsSync(file)) chunks.push({ file, offsetSec: Number(start) || 0 });
    }
    fs.rmSync(listFile, { force: true });
  }

  if (chunks.length === 0) {
    // No list (older ffmpeg?) — fall back to reading the files in order.
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`spc_${videoId}_`) && f.endsWith(".mp3"))
      .sort();
    files.forEach((f, i) => chunks.push({ file: path.join(dir, f), offsetSec: i * CHUNK_SEC }));
  }

  if (chunks.length === 0) throw new Error("오디오를 처리하지 못했습니다.");
  return chunks;
}

export function cleanupChunks(chunks: AudioChunk[]): void {
  for (const c of chunks) fs.rmSync(c.file, { force: true });
}
