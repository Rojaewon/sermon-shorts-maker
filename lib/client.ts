"use client";

// Client-side API helpers with job polling.

import type { AnalyzeResult, Highlight, SubtitleOptions, TemplateId } from "./types";

async function pollJob<T>(jobId: string, onProgress?: (p: number, msg: string) => void): Promise<T> {
  for (;;) {
    const r = await fetch(`/api/jobs/${jobId}`);
    if (!r.ok) throw new Error("작업 상태를 가져오지 못했습니다.");
    const j = await r.json();
    onProgress?.(j.progress ?? 0, j.message ?? "");
    if (j.status === "done") return j.result as T;
    if (j.status === "error") throw new Error(j.error || "작업 실패");
    await new Promise((res) => setTimeout(res, 900));
  }
}

export async function analyze(
  url: string,
  apiKey: string,
  targetSec: number,
  onProgress?: (p: number, msg: string) => void,
): Promise<AnalyzeResult> {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, apiKey, targetSec }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "분석 요청 실패");
  return pollJob<AnalyzeResult>(data.jobId, onProgress);
}

export async function renderShort(
  args: {
    url: string;
    videoId: string;
    highlight: Highlight;
    template: TemplateId;
    subtitles: SubtitleOptions;
    churchName?: string;
  },
  onProgress?: (p: number, msg: string) => void,
): Promise<{ url: string; name: string }> {
  const r = await fetch("/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "렌더 요청 실패");
  return pollJob(data.jobId, onProgress);
}

export async function addCustomRange(args: {
  videoId: string;
  startSec: number;
  endSec: number;
  apiKey: string;
}): Promise<Highlight> {
  const r = await fetch("/api/custom-range", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "구간 추가 실패");
  return data.highlight as Highlight;
}
