// Break long caption cues into two-line chunks.
//
// YouTube's auto-captions arrive pre-chopped (~24 chars), but the speech
// fallback returns whole paragraphs in one cue — 110 characters that libass
// then wrapped into five lines covering the preacher's face.
//
// Rule, from the user: aim for two lines; allow a third only when splitting
// into two would be awkward. So we only ever cut at a real boundary in the
// speech — a sentence end, then a clause end, then a word gap — and a chunk
// that overshoots two lines but has nowhere natural to break is left as three
// rather than hacked apart mid-phrase.

import type { Cue } from "./types";
import type { SubtitleSize } from "./types";

// Longest string libass still lays out on ONE line, measured per size by
// rendering real Korean prose and counting the lines it produced
// (assets/fonts Pretendard, 1080px canvas, 80px side margins).
const CHARS_PER_LINE: Record<SubtitleSize, number> = {
  small: 34,
  medium: 28,
  large: 23,
  xlarge: 19,
};

// Character counts vary with content — spaces are narrow, Hangul is full-width —
// so leave a little slack rather than sitting exactly on the measured limit.
const SAFETY = 0.94;

export function lineBudget(size: SubtitleSize): { two: number; three: number } {
  const per = CHARS_PER_LINE[size] * SAFETY;
  return { two: Math.floor(per * 2), three: Math.floor(per * 3) };
}

const len = (s: string) => [...s.trim()].length;

// Split points, strongest first. Each returns the pieces or null if it can't.
function bySentence(text: string): string[] | null {
  // Keeps the punctuation with the sentence it ends.
  const parts = text.split(/(?<=[.!?。！？])\s+/).filter((s) => s.trim());
  return parts.length > 1 ? parts : null;
}

function byClause(text: string): string[] | null {
  const parts = text.split(/(?<=[,،、])\s+/).filter((s) => s.trim());
  return parts.length > 1 ? parts : null;
}

// Korean connective endings — the natural breath points when there is no
// punctuation at all, which is the normal case for auto-captions.
const CONNECTIVE = /(?<=(?:고|며|서|면|지만|는데|으나|나|아서|어서|니까|다가|거나|든지))\s+/;

function byConnective(text: string): string[] | null {
  const parts = text.split(CONNECTIVE).filter((s) => s.trim());
  return parts.length > 1 ? parts : null;
}

// Last resort: cut at the word gap nearest the middle, so neither half is a
// stub. Still never mid-word.
function byMiddleSpace(text: string): string[] | null {
  const t = text.trim();
  const gaps: number[] = [];
  for (let i = 0; i < t.length; i++) if (t[i] === " ") gaps.push(i);
  if (!gaps.length) return null;
  const mid = t.length / 2;
  const at = gaps.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
  return [t.slice(0, at), t.slice(at + 1)];
}

// Glue neighbours back together while they still fit on two lines, so a run of
// short sentences doesn't flash by one at a time.
function mergeShort(parts: string[], two: number): string[] {
  const out: string[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && len(`${last} ${p}`) <= two) out[out.length - 1] = `${last} ${p}`;
    else out.push(p.trim());
  }
  return out;
}

function splitText(text: string, two: number, three: number): string[] {
  const t = text.trim();
  if (!t) return [];
  if (len(t) <= two) return [t];

  for (const strategy of [bySentence, byClause, byConnective]) {
    const parts = strategy(t);
    if (!parts) continue;
    return mergeShort(
      parts.flatMap((p) => splitText(p, two, three)),
      two,
    );
  }

  // No natural boundary left. Three lines beats a clumsy cut, so only force a
  // break once even three lines would overflow.
  if (len(t) <= three) return [t];
  const halves = byMiddleSpace(t);
  if (!halves) return [t]; // one unbroken word — nothing sane to do
  return halves.flatMap((p) => splitText(p, two, three));
}

// Split a cue, handing each piece a share of the original duration in
// proportion to its length. Timing stays inside the original window, so a split
// cue can never bleed past the clip it belongs to.
export function splitCues(cues: Cue[], size: SubtitleSize): Cue[] {
  const { two, three } = lineBudget(size);
  const out: Cue[] = [];

  for (const cue of cues) {
    const pieces = splitText(cue.text, two, three);
    if (pieces.length <= 1) {
      if (cue.text.trim()) out.push({ ...cue, text: cue.text.trim() });
      continue;
    }
    const total = pieces.reduce((n, p) => n + len(p), 0) || 1;
    const span = Math.max(0, cue.end - cue.start);
    let t = cue.start;
    pieces.forEach((p, i) => {
      const share = (len(p) / total) * span;
      const start = t;
      const end = i === pieces.length - 1 ? cue.end : Math.min(cue.end, start + share);
      t = end;
      if (end > start) out.push({ start, end, text: p });
    });
  }
  return out;
}
