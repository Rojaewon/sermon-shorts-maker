// Gemini analysis — 2-pass highlight selection with context awareness.
//
// Pass 1: read the whole transcript, extract the sermon's structure (sections).
// Pass 2: given that structure + cue-indexed transcript, pick 5-6 highlights.
//         Output is CUE INDICES (not free seconds) so boundaries land on cue edges.

import { GoogleGenAI, Type } from "@google/genai";
import type { Cue } from "./types";

// Tried in order until one works with the user's key. Newer keys may not have
// access to older models ("no longer available to new users") and vice versa.
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

// Errors that mean "this model isn't available to this key" — try the next one.
const MODEL_UNAVAILABLE_RE =
  /not found|not supported|no longer available|permission|NOT_FOUND|404/i;

// Transient errors (server busy / rate limit) — retry with backoff, then try
// the next model (a different model often has spare capacity).
//
// "fetch failed" belongs here: it is what Node throws for any transport-level
// failure, including the request being abandoned on timeout. It used to fall
// through to the rethrow below, so a single slow call killed a whole multi-part
// transcription with a message that meant nothing to the user.
const TRANSIENT_RE =
  /503|UNAVAILABLE|overloaded|high demand|try again|429|RESOURCE_EXHAUSTED|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|aborted|timeout/i;

// Never let one call sit until Node's own 5-minute ceiling: at that point it
// dies as a bare "fetch failed" and we've burned five minutes learning nothing.
// Failing earlier leaves time to actually retry.
const REQUEST_TIMEOUT_MS = 150_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run `fn` against each candidate model: up to 3 attempts per model for
// transient errors, skip to the next model when unavailable, rethrow otherwise.
async function withModelFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  // Cap total tries across all models. Per-model retries alone would allow
  // 3 models x 3 attempts, and with a 150s request timeout that is twenty
  // minutes of a frozen progress bar before the user is told anything.
  let budget = 4;
  for (const model of MODEL_CANDIDATES) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (budget <= 0) break;
      budget--;
      try {
        return await fn(model);
      } catch (e) {
        lastErr = e;
        const msg = String((e as Error)?.message || e);
        if (TRANSIENT_RE.test(msg)) {
          if (attempt < 3 && budget > 0) await sleep(1500 * attempt);
          continue;
        }
        if (MODEL_UNAVAILABLE_RE.test(msg)) break; // next model
        throw e;
      }
    }
  }
  const msg = String((lastErr as Error)?.message || lastErr);
  if (/fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|network|socket hang up/i.test(msg)) {
    throw new Error(
      "구글 AI 서버와 연결하지 못했습니다.\n인터넷 연결을 확인하시고 잠시 후 다시 시도해 주세요.",
    );
  }
  if (TRANSIENT_RE.test(msg)) {
    throw new Error("AI 모델이 지금 혼잡합니다(구글 서버 일시 과부하). 1~2분 뒤 다시 시도해 주세요.");
  }
  throw lastErr;
}

function client(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

// number transcript lines with cue indices for the model
function numberedTranscript(cues: Cue[]): string {
  return cues.map((c, i) => `[${i}] (${fmt(c.start)}) ${c.text}`).join("\n");
}
function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

async function genJson<T>(
  apiKey: string,
  prompt: string,
  schema: unknown,
): Promise<T> {
  const ai = client(apiKey);
  return withModelFallback(async (model) => {
    const resp = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema as never,
        temperature: 0.4,
      },
    });
    const text = resp.text;
    if (!text) throw new Error("empty response");
    return JSON.parse(text) as T;
  });
}

// ---- Pass 1: structure ----
interface Section {
  title: string;
  startCueIdx: number;
  endCueIdx: number;
  point: string;
}
interface StructureResult {
  centralMessage: string;
  scripture: string;
  sections: Section[];
}

const structureSchema = {
  type: Type.OBJECT,
  properties: {
    centralMessage: { type: Type.STRING },
    scripture: { type: Type.STRING },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          startCueIdx: { type: Type.INTEGER },
          endCueIdx: { type: Type.INTEGER },
          point: { type: Type.STRING },
        },
        required: ["title", "startCueIdx", "endCueIdx", "point"],
      },
    },
  },
  required: ["centralMessage", "scripture", "sections"],
};

async function analyzeStructure(apiKey: string, cues: Cue[]): Promise<StructureResult> {
  const prompt = `당신은 한국어 설교를 분석하는 전문가입니다. 아래는 설교 전체의 자동 생성 자막입니다. 각 줄 앞의 [숫자]는 자막 인덱스, (분:초)는 시작 시각입니다.

이 설교의 구조를 분석해 JSON으로 답하세요:
- centralMessage: 이 설교의 중심 메시지 한 문장
- scripture: 본문 성경 구절 (알 수 있으면)
- sections: 설교의 대지(단락) 목록. 각 대지는 title(제목), startCueIdx/endCueIdx(해당 대지가 차지하는 자막 인덱스 범위), point(그 대지의 핵심 요지).

대지는 3~6개 정도로 나누세요. 도입부와 결론도 하나의 대지가 될 수 있습니다.

자막:
${numberedTranscript(cues)}`;

  return genJson<StructureResult>(apiKey, prompt, structureSchema);
}

// ---- Pass 2: highlights ----
export interface RawHighlight {
  startCueIdx: number;
  endCueIdx: number;
  titleLine1: string;
  titleLine2: string;
  summary: string;
  sectionTitle: string;
}

const highlightsSchema = {
  type: Type.OBJECT,
  properties: {
    highlights: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          startCueIdx: { type: Type.INTEGER },
          endCueIdx: { type: Type.INTEGER },
          titleLine1: { type: Type.STRING },
          titleLine2: { type: Type.STRING },
          summary: { type: Type.STRING },
          sectionTitle: { type: Type.STRING },
        },
        required: ["startCueIdx", "endCueIdx", "titleLine1", "titleLine2", "summary", "sectionTitle"],
      },
    },
  },
  required: ["highlights"],
};

export async function analyzeHighlights(
  apiKey: string,
  cues: Cue[],
  targetSec: number,
): Promise<RawHighlight[]> {
  const structure = await analyzeStructure(apiKey, cues);

  // approx cues for target length (avg cue ~5s)
  const avgCueDur =
    cues.length > 1 ? (cues[cues.length - 1].end - cues[0].start) / cues.length : 5;
  const approxCues = Math.max(4, Math.round(targetSec / avgCueDur));

  const prompt = `당신은 설교 영상에서 쇼츠(짧은 영상)로 만들 하이라이트 구간을 고르는 편집자입니다.

## 설교 구조 (미리 분석됨)
중심 메시지: ${structure.centralMessage}
본문: ${structure.scripture}
대지:
${structure.sections.map((s) => `- "${s.title}" [자막 ${s.startCueIdx}~${s.endCueIdx}]: ${s.point}`).join("\n")}

## 자막 (인덱스, 시각 포함)
${numberedTranscript(cues)}

## 과제
위 자막에서 쇼츠로 만들 하이라이트 5~6개를 골라 JSON으로 답하세요. 각 하이라이트는:
- startCueIdx, endCueIdx: 자막 인덱스로 구간 지정. 목표 길이는 약 ${targetSec}초(대략 ${approxCues}개 자막 분량)이며, 30초~2분 사이여야 합니다.
- titleLine1, titleLine2: 쇼츠 상단에 2줄로 들어갈 제목. **titleLine2가 강조되는 핵심 문구**가 되도록 나누세요. 각 줄은 짧고 강렬하게(줄당 대략 6~12자).
- summary: 이 구간이 어떤 내용인지 1~2문장 요약.
- sectionTitle: 이 하이라이트가 속한 대지 제목.

## 반드시 지킬 규칙
1. **문맥 자족성**: 그 구간만 따로 봐도 이해되어야 합니다. 결론 문장만 떼지 말고, 그 결론이 이해되는 데 필요한 도입·설명을 앞 자막부터 포함하세요.
2. **시작 규칙**: "이것", "그래서", "그러니까", "아까 말씀드린", "그런" 처럼 앞을 가리키는 말로 시작하는 자막에서 시작하지 마세요. 새로운 생각이 시작되는 자막에서 시작하세요.
3. **끝 규칙**: endCueIdx는 말이 완결되는(문장이 끝나는) 자막이어야 합니다. 말 중간에서 끊지 마세요.
4. **다양성**: 서로 다른 대지에서 골고루 뽑아 내용이 겹치지 않게 하세요.
5. 감정적으로나 메시지 면에서 강력한, 청중의 마음을 움직일 구간을 우선하세요.`;

  const result = await genJson<{ highlights: RawHighlight[] }>(apiKey, prompt, highlightsSchema);
  return result.highlights;
}

// Generate a 2-line title for a user-added custom range.
const titleSchema = {
  type: Type.OBJECT,
  properties: {
    titleLine1: { type: Type.STRING },
    titleLine2: { type: Type.STRING },
    summary: { type: Type.STRING },
  },
  required: ["titleLine1", "titleLine2", "summary"],
};

export async function generateTitle(
  apiKey: string,
  text: string,
): Promise<{ titleLine1: string; titleLine2: string; summary: string }> {
  const prompt = `아래는 설교 중 한 구간의 자막입니다. 이 구간을 쇼츠로 만들 때 상단에 넣을 2줄 제목과 1문장 요약을 JSON으로 만들어 주세요. titleLine2가 강조 문구가 되도록 하고, 각 줄은 6~12자로 짧고 강렬하게.

자막:
${text}`;
  return genJson(apiKey, prompt, titleSchema);
}

// Transcription fallback (no captions): send audio to Gemini for timestamped transcript.
export async function transcribeAudio(
  apiKey: string,
  audioBase64: string,
  mimeType: string,
): Promise<Cue[]> {
  const ai = client(apiKey);
  const schema = {
    type: Type.OBJECT,
    properties: {
      cues: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            start: { type: Type.NUMBER },
            end: { type: Type.NUMBER },
            text: { type: Type.STRING },
          },
          required: ["start", "end", "text"],
        },
      },
    },
    required: ["cues"],
  };
  return withModelFallback(async (model) => {
    const contents = [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          {
            // "문장 단위" alone produced whole paragraphs in a single cue, which
            // then wrapped into five lines of subtitle. Ask for caption-sized
            // pieces explicitly.
            text:
              "이 오디오는 한국어 설교입니다. 전체를 전사해 주세요.\n" +
              "자막으로 쓸 것이므로 짧게 끊어 주세요. 한 항목은 20자 안팎, 최대 40자를 넘기지 마세요.\n" +
              "문장이 길면 쉼표나 '~고/~며/~면/~는데' 같은 자연스러운 지점에서 나누고, 단어 중간에서는 절대 끊지 마세요.\n" +
              "각 항목의 시작/끝 시각(초)과 텍스트를 JSON으로 주세요.",
          },
        ],
      },
    ];
    const config = {
      responseMimeType: "application/json",
      responseSchema: schema as never,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS },
    };

    // Transcription is dictation, not reasoning, so the newer models' thinking
    // pass buys nothing and costs latency — the very thing that pushed a long
    // chunk past the request deadline. Not every model accepts a zero budget,
    // so a rejection just means asking again without it rather than failing.
    let resp;
    try {
      resp = await ai.models.generateContent({
        model,
        contents,
        config: { ...config, thinkingConfig: { thinkingBudget: 0 } },
      });
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (!/thinking|thought|INVALID_ARGUMENT|400/i.test(msg)) throw e;
      resp = await ai.models.generateContent({ model, contents, config });
    }
    const text = resp.text;
    if (!text) throw new Error("empty");
    return (JSON.parse(text) as { cues: Cue[] }).cues;
  });
}
