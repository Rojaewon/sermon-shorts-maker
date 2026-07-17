"use client";

import { useEffect, useState } from "react";
import type { TemplateId } from "@/lib/types";
import { TEMPLATES } from "@/lib/layout";

export interface SetupValues {
  apiKey: string;
  url: string;
  targetSec: number;
  template: TemplateId;
  churchName: string;
}

const TARGETS = [
  { sec: 30, label: "30초" },
  { sec: 60, label: "1분" },
  { sec: 120, label: "2분" },
];

export default function SetupForm({
  onSubmit,
  busy,
}: {
  onSubmit: (v: SetupValues) => void;
  busy: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [savedKey, setSavedKey] = useState(false);
  const [url, setUrl] = useState("");
  const [targetSec, setTargetSec] = useState(60);
  const [template, setTemplate] = useState<TemplateId>("dark");
  const [churchName, setChurchName] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const k = localStorage.getItem("gemini_api_key");
    if (k) {
      setApiKey(k);
      setSavedKey(true);
    }
    const c = localStorage.getItem("church_name");
    if (c) setChurchName(c);
  }, []);

  function submit() {
    if (!url.trim()) return;
    if (apiKey.trim()) localStorage.setItem("gemini_api_key", apiKey.trim());
    if (churchName.trim()) localStorage.setItem("church_name", churchName.trim());
    onSubmit({ apiKey: apiKey.trim(), url: url.trim(), targetSec, template, churchName: churchName.trim() });
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">
          설교 전체 영상을
          <br />
          <span className="text-accent">쇼츠 영상</span>으로
        </h1>
        <p className="mt-4 text-muted">
          설교(예배) 유튜브 링크를 넣으면 AI가 하이라이트를 찾아
          <br className="hidden sm:block" /> 쇼츠를 만들어 드립니다 (자막 on/off 가능).
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-6 shadow-xl sm:p-8">
        {/* API key */}
        <Field n={1} label="Gemini API 키" hint={savedKey ? "✓ 저장됨" : undefined}>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSavedKey(false);
              }}
              placeholder="AIza..."
              className="input pr-12"
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white"
            >
              {showKey ? "숨기기" : "보기"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            이 브라우저에만 저장됩니다. 키가 없으면{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              여기서 무료 발급
            </a>
            받으세요.
          </p>
        </Field>

        {/* URL */}
        <Field n={2} label="설교 유튜브 링크">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="input"
          />
          <p className="mt-2 text-xs text-muted">
            찬양·광고가 포함된 예배 전체 영상도 괜찮아요. 설교 부분을 자동으로 찾습니다.
          </p>
        </Field>

        {/* target length */}
        <Field n={3} label="쇼츠 길이">
          <div className="grid grid-cols-3 gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.sec}
                onClick={() => setTargetSec(t.sec)}
                className={`rounded-xl border py-3 font-bold transition ${
                  targetSec === t.sec
                    ? "border-accent bg-accent text-black"
                    : "border-line bg-panel2 text-muted hover:border-accent/50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        {/* template */}
        <Field n={4} label="템플릿 (스타일)">
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => (
              <TemplateSwatch
                key={id}
                id={id}
                active={template === id}
                onClick={() => setTemplate(id)}
              />
            ))}
          </div>
        </Field>

        {/* church name */}
        <Field n={5} label="교회명 (선택)">
          <input
            value={churchName}
            onChange={(e) => setChurchName(e.target.value)}
            placeholder="예) 사랑교회"
            className="input"
          />
        </Field>

        <button
          onClick={submit}
          disabled={busy || !url.trim()}
          className="mt-2 w-full rounded-xl bg-accent py-4 text-lg font-extrabold text-black transition hover:bg-accent2 disabled:opacity-40"
        >
          {busy ? "분석 중..." : "✦ 하이라이트 찾아 쇼츠 만들기"}
        </button>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
          본인이 권리를 가진 설교 영상(예: 소속 교회가 업로드한 영상)에만 사용하세요.
        </p>
      </div>
    </div>
  );
}

function Field({
  n,
  label,
  hint,
  children,
}: {
  n: number;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
          {n}
        </span>
        <span className="font-bold">{label}</span>
        {hint && <span className="text-xs font-medium text-emerald-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TemplateSwatch({
  id,
  active,
  onClick,
}: {
  id: TemplateId;
  active: boolean;
  onClick: () => void;
}) {
  const t = TEMPLATES[id];
  return (
    <button
      onClick={onClick}
      className={`overflow-hidden rounded-xl border-2 transition ${
        active ? "border-accent" : "border-line hover:border-accent/40"
      }`}
    >
      <div className="aspect-[9/16] w-full p-3 text-center" style={{ background: t.bg }}>
        <div className="flex h-full flex-col justify-between">
          <div>
            <div className="text-[11px] font-extrabold leading-tight" style={{ color: t.titleLine1 }}>
              내 열심보다
            </div>
            <div className="text-[13px] font-extrabold leading-tight" style={{ color: t.titleLine2 }}>
              하나님의 이끄심
            </div>
          </div>
          <div className="mx-auto h-8 w-full rounded bg-black/20" />
          <div className="text-[9px] font-medium" style={{ color: t.subtitle }}>
            하나님이 나를 이끄십니다
          </div>
        </div>
      </div>
      <div className="bg-panel2 py-1.5 text-xs font-bold">{t.label}</div>
    </button>
  );
}
