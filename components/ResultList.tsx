"use client";

import { useState } from "react";
import type { Cue, Highlight, SubtitleOptions, TitleStyle } from "@/lib/types";
import { DEFAULT_TITLE_STYLE } from "@/lib/types";
import { mmss } from "@/lib/format";
import { SubtitleControls, TitleControls } from "./StyleControls";

export interface RenderedItem {
  highlight: Highlight;
  status: "pending" | "rendering" | "done" | "error";
  progress: number;
  message: string;
  url?: string;
  name?: string;
  error?: string;
}

export default function ResultList({
  items,
  onRerender,
  onBack,
}: {
  items: RenderedItem[];
  // Anything the user changed here means re-rendering that one clip.
  onRerender: (highlightId: string, patch: Partial<Highlight>) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<RenderedItem | null>(null);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-extrabold">쇼츠가 완성됐어요 🎉</h2>
        <button onClick={onBack} className="text-sm text-muted hover:text-white">
          ← 구간 다시 고르기
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {items.map((it) => (
          <div key={it.highlight.id} className="rounded-2xl border border-line bg-panel p-4">
            <div className="mb-3 text-sm text-muted">
              {mmss(it.highlight.startSec)} – {mmss(it.highlight.endSec)} · {it.highlight.titleLine1}{" "}
              {it.highlight.titleLine2}
            </div>

            {it.status === "done" && it.url ? (
              <>
                {/* preload="none": with 5-6 clips on screen, the default would
                    have the browser open a decoder for every one of them at
                    once. Nothing is decoded until the user actually hits play. */}
                <video
                  src={it.url}
                  controls
                  playsInline
                  preload="none"
                  className="mx-auto aspect-[9/16] w-full max-w-[280px] rounded-xl bg-black"
                />
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setEditing(it)}
                    className="flex-1 rounded-xl border border-line bg-panel2 py-2.5 text-sm font-bold hover:border-accent"
                  >
                    ✎ 수정
                  </button>
                  <a
                    href={`${it.url}&download=1`}
                    className="flex-1 rounded-xl bg-accent py-2.5 text-center text-sm font-extrabold text-black hover:bg-accent2"
                  >
                    ⬇ 다운로드
                  </a>
                </div>
              </>
            ) : it.status === "error" ? (
              <div className="flex aspect-[9/16] max-w-[280px] mx-auto items-center justify-center rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-center text-sm text-red-400">
                {it.error || "렌더링 실패"}
              </div>
            ) : (
              <div className="mx-auto flex aspect-[9/16] max-w-[280px] flex-col items-center justify-center rounded-xl bg-panel2">
                <Spinner />
                <div className="mt-3 text-sm text-muted">{it.message}</div>
                <div className="mt-3 h-1.5 w-32 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${Math.round(it.progress * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <EditModal
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            onRerender(editing.highlight.id, patch);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

type Tab = "style" | "text";

function EditModal({
  item,
  onClose,
  onSave,
}: {
  item: RenderedItem;
  onClose: () => void;
  onSave: (patch: Partial<Highlight>) => void;
}) {
  const h = item.highlight;
  const [tab, setTab] = useState<Tab>("style");
  const [cues, setCues] = useState<Cue[]>(h.cues.map((c) => ({ ...c })));
  const [line1, setLine1] = useState(h.titleLine1);
  const [line2, setLine2] = useState(h.titleLine2);
  const [titleStyle, setTitleStyle] = useState<TitleStyle>(h.titleStyle ?? DEFAULT_TITLE_STYLE);
  const [subtitles, setSubtitles] = useState<SubtitleOptions>(
    h.subtitles ?? { enabled: true, size: "large", position: "band" },
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-panel">
        <div className="border-b border-line p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">수정</h3>
            <button onClick={onClose} className="text-muted hover:text-white">
              ✕
            </button>
          </div>
          <p className="mt-1 text-sm text-muted">
            고친 뒤 [다시 만들기]를 누르면 이 영상만 새로 만듭니다. 30초 정도 걸려요.
          </p>
          <div className="mt-4 flex gap-2">
            <TabBtn active={tab === "style"} onClick={() => setTab("style")}>
              제목 · 자막 설정
            </TabBtn>
            <TabBtn active={tab === "text"} onClick={() => setTab("text")}>
              자막 글자 고치기
            </TabBtn>
          </div>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-5">
          {tab === "style" ? (
            <div className="space-y-6">
              <TitleControls
                value={titleStyle}
                onChange={setTitleStyle}
                line1={line1}
                line2={line2}
                onLine1={setLine1}
                onLine2={setLine2}
              />
              <div className="border-t border-line pt-5">
                <SubtitleControls value={subtitles} onChange={setSubtitles} />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="mb-3 text-sm text-muted">
                잘못 인식된 글자를 고쳐 보세요. 줄 수와 타이밍은 그대로 유지됩니다.
              </p>
              {cues.map((c, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-2.5 w-12 flex-shrink-0 font-mono text-xs text-muted">
                    {mmss(c.start)}
                  </span>
                  <textarea
                    value={c.text}
                    onChange={(e) => {
                      const n = [...cues];
                      n[i] = { ...n[i], text: e.target.value };
                      setCues(n);
                    }}
                    rows={1}
                    className="input min-h-[42px] resize-y py-2 text-sm"
                  />
                </div>
              ))}
              {cues.length === 0 && (
                <p className="py-8 text-center text-sm text-muted">이 구간에는 자막이 없습니다.</p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 border-t border-line p-5">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-line py-3 font-bold text-muted hover:text-white"
          >
            취소
          </button>
          <button
            onClick={() =>
              onSave({ cues, titleLine1: line1, titleLine2: line2, titleStyle, subtitles })
            }
            className="flex-1 rounded-xl bg-accent py-3 font-extrabold text-black hover:bg-accent2"
          >
            다시 만들기
          </button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
        active ? "bg-panel2 text-white" : "text-muted hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
  );
}
