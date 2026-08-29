import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createJob, runJob } from "@/lib/jobs";
import { fetchVideo } from "@/lib/pipeline";
import { renderHighlight } from "@/lib/render";
import { outUrl } from "@/lib/storage";
import type { RenderRequest, Cue } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 600;

// Everything that changes what the output looks like, squeezed into a short
// tag. Spelling each option out made the filename grow with every new setting;
// this keeps distinct settings as distinct files without that.
function styleTag(o: unknown): string {
  return createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 8);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RenderRequest & { url: string };
  const { url, videoId, highlight, template, churchName } = body;
  if (!url || !videoId || !highlight) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  // The highlight carries its own look once rendering starts (the result screen
  // edits it per clip); body.subtitles is the pre-render default.
  const subtitles = highlight.subtitles ?? body.subtitles;
  if (!subtitles) {
    return NextResponse.json({ error: "자막 설정이 없습니다." }, { status: 400 });
  }

  const job = createJob("render");
  runJob(job, async (progress) => {
    progress(0.05, "원본 영상을 준비하는 중...");
    const source = await fetchVideo(url, videoId, (p) =>
      progress(0.05 + p * 0.5, "원본 영상을 내려받는 중..."),
    );

    progress(0.6, "쇼츠를 렌더링하는 중...");
    const fit = highlight.fit ?? "crop";
    const tag = styleTag({
      template,
      fit,
      subtitles,
      titleStyle: highlight.titleStyle,
      churchName,
      t1: highlight.titleLine1,
      t2: highlight.titleLine2,
      cues: highlight.cues,
    });
    const outName = `${videoId}_${highlight.id}_${tag}.mp4`;
    await renderHighlight({
      sourcePath: source,
      startSec: highlight.startSec,
      endSec: highlight.endSec,
      template,
      titleLine1: highlight.titleLine1,
      titleLine2: highlight.titleLine2,
      titleStyle: highlight.titleStyle,
      churchName,
      cues: highlight.cues as Cue[],
      subtitles,
      fit,
      outName,
      onProgress: (p) => progress(0.6 + p * 0.4, "쇼츠를 렌더링하는 중..."),
    });

    return { url: outUrl(outName), name: outName };
  });

  return NextResponse.json({ jobId: job.id });
}
