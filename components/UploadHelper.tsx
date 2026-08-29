"use client";

// Walks the user through putting a finished short on YouTube.
//
// Not a real upload: videos inserted through an un-audited API project are
// locked private with no way to publish them, so the app does everything up to
// the paste and hands off. See lib/youtube-meta.ts.

import { useEffect, useState } from "react";
import type { Highlight } from "@/lib/types";
import { buildUploadMeta } from "@/lib/youtube-meta";
import { copyText, saveClipAs } from "@/lib/desktop";

const YOUTUBE_UPLOAD_URL = "https://www.youtube.com/upload";

export default function UploadHelper({
  highlight,
  fileName,
  downloadUrl,
  churchName,
  sourceUrl,
  onClose,
}: {
  highlight: Highlight;
  fileName: string; // the rendered file's real name on disk
  downloadUrl: string;
  churchName?: string;
  sourceUrl?: string;
  onClose: () => void;
}) {
  const meta = buildUploadMeta(highlight, { churchName, sourceUrl });
  const [title, setTitle] = useState(meta.title);
  const [description, setDescription] = useState(meta.description);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [copied, setCopied] = useState<"title" | "desc" | null>(null);

  // Put the title on the clipboard immediately — it's the first thing YouTube
  // asks for, so most of the time no extra click is needed.
  useEffect(() => {
    void copyText(meta.title).then((ok) => ok && setCopied("title"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doCopy(which: "title" | "desc") {
    const ok = await copyText(which === "title" ? title : description);
    if (ok) {
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
    }
  }

  async function doSave() {
    setSaved("saving");
    const r = await saveClipAs(fileName, meta.fileName, downloadUrl);
    setSaved(r === "saved" ? "saved" : r === "canceled" ? "idle" : "failed");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-panel">
        <div className="border-b border-line p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">유튜브에 올리기</h3>
            <button onClick={onClose} className="text-muted hover:text-white">
              ✕
            </button>
          </div>
          <p className="mt-1 text-sm text-muted">
            아래 순서대로 하시면 됩니다. 제목은 이미 복사해 두었어요.
          </p>
        </div>

        <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
          {/* 1 */}
          <Step n={1} label="영상 파일을 저장하세요">
            <button
              onClick={doSave}
              disabled={saved === "saving"}
              className="w-full rounded-xl border border-line bg-panel2 py-3 font-bold hover:border-accent disabled:opacity-50"
            >
              {saved === "saving" ? "저장 중..." : saved === "saved" ? "✓ 저장됨 — 폴더를 열었어요" : "💾 영상 저장하기"}
            </button>
            {saved === "failed" && (
              <p className="mt-2 text-sm text-red-400">저장하지 못했습니다. 다시 시도해 주세요.</p>
            )}
            <p className="mt-2 text-xs text-muted">
              파일 이름은 <span className="text-white">{meta.fileName}</span> 으로 저장됩니다.
            </p>
          </Step>

          {/* 2 */}
          <Step n={2} label="유튜브 업로드 페이지를 여세요">
            <a
              href={YOUTUBE_UPLOAD_URL}
              target="_blank"
              rel="noreferrer"
              className="block w-full rounded-xl bg-accent py-3 text-center font-extrabold text-black hover:bg-accent2"
            >
              ▶ 유튜브 업로드 열기
            </a>
            <p className="mt-2 text-xs text-muted">
              열린 창에 방금 저장한 영상 파일을 끌어다 놓으세요.
            </p>
          </Step>

          {/* 3 */}
          <Step n={3} label="제목과 설명을 붙여넣으세요">
            <div className="space-y-3">
              <Copyable
                label="제목"
                copied={copied === "title"}
                onCopy={() => doCopy("title")}
              >
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input py-2 text-sm"
                />
              </Copyable>
              <Copyable
                label="설명"
                copied={copied === "desc"}
                onCopy={() => doCopy("desc")}
              >
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="input resize-y py-2 text-sm"
                />
              </Copyable>
            </div>
          </Step>

          <p className="rounded-xl border border-line bg-panel2 p-3 text-xs leading-relaxed text-muted">
            세로 영상이고 3분 이내라 유튜브가 <span className="text-white">자동으로 쇼츠로 인식</span>합니다.
            따로 설정하실 것은 없어요.
          </p>
        </div>

        <div className="border-t border-line p-5">
          <button
            onClick={onClose}
            className="w-full rounded-xl border border-line py-3 font-bold text-muted hover:text-white"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
          {n}
        </span>
        <span className="font-bold">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Copyable({
  label,
  copied,
  onCopy,
  children,
}: {
  label: string;
  copied: boolean;
  onCopy: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        <button
          onClick={onCopy}
          className={`text-xs font-bold ${copied ? "text-emerald-400" : "text-accent hover:underline"}`}
        >
          {copied ? "✓ 복사됨" : "복사"}
        </button>
      </div>
      {children}
    </div>
  );
}
