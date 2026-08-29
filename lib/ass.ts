// Build an ASS subtitle file containing BOTH the fixed 2-line title and the
// timed dialogue. Burned in one subtitles-filter pass.
//
// Canvas is the full 1080x1920 (PlayResX/Y), so all coordinates match layout.ts.

import { TITLE_FONT_NAME, SUB_FONT_NAME } from "./binaries";
import {
  CANVAS_W,
  CANVAS_H,
  TITLE,
  SUB_FONT_SIZE,
  subtitlePlacement,
  titlePlacement,
  TEMPLATES,
  CHURCH,
} from "./layout";
import { splitCues } from "./subtitles";
import type { Cue, SubtitleOptions, TemplateId, TitleStyle } from "./types";

// hex "#RRGGBB" -> ASS "&HAABBGGRR" (AA=00 opaque)
function assColor(hex: string, alpha = "00"): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

function sec2ass(s: number): string {
  const cs = Math.round((s % 1) * 100);
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function esc(text: string): string {
  return text.replace(/\n/g, "\\N").replace(/\{/g, "(").replace(/\}/g, ")");
}

export interface AssParams {
  template: TemplateId;
  titleLine1: string;
  titleLine2: string;
  titleStyle?: TitleStyle;
  clipDurationSec: number; // title shows for whole clip
  cues: Cue[]; // already shifted to clip-relative timing
  subtitles: SubtitleOptions;
  churchName?: string;
}

export function buildAss(p: AssParams): string {
  const tpl = TEMPLATES[p.template];
  const subFont = SUB_FONT_SIZE[p.subtitles.size];
  const place = subtitlePlacement(p.subtitles.position);

  const church = p.churchName?.trim();
  // A bottom-anchored subtitle would sit on top of the church line, so lift it
  // clear when both are present. Only the lowest preset is close enough to
  // collide; the others already sit well above.
  if (church && p.subtitles.position === "screen-bottom") {
    place.marginV += CHURCH.reservedHeight;
  }

  const title = titlePlacement(p.titleStyle?.size ?? "medium");
  // Fall back to the template's colors when the user hasn't picked one.
  const c1 = p.titleStyle?.line1Color || tpl.titleLine1;
  const c2 = p.titleStyle?.line2Color || tpl.titleLine2;

  const styles = [
    // Title lines: no outline, centered; we position each with \pos overrides.
    `Style: Title,${TITLE_FONT_NAME},${title.fontSize},${assColor(c1)},${assColor(c1)},${assColor(tpl.bg)},&H64000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    `Style: TitleAccent,${TITLE_FONT_NAME},${title.fontSize},${assColor(c2)},${assColor(c2)},${assColor(tpl.bg)},&H64000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    // Subtitle: outlined for readability, bottom-anchored via alignment/marginV.
    `Style: Sub,${SUB_FONT_NAME},${subFont},${assColor(tpl.subtitle)},${assColor(tpl.subtitle)},${assColor(tpl.subtitleOutline)},&H96000000,1,0,0,0,100,100,0,0,1,4,1,${place.alignment},80,80,${place.marginV},1`,
    // Church credit: quiet, semi-transparent, bottom-centred.
    `Style: Church,${SUB_FONT_NAME},${CHURCH.fontSize},${assColor(tpl.subtitle, CHURCH.opacityHex)},${assColor(tpl.subtitle, CHURCH.opacityHex)},${assColor(tpl.subtitleOutline, CHURCH.opacityHex)},&H96000000,0,0,0,0,100,100,0,0,1,2,0,2,60,60,${CHURCH.marginV},1`,
  ].join("\n");

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${CANVAS_W}
PlayResY: ${CANVAS_H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events: string[] = [];
  const end = sec2ass(p.clipDurationSec);

  // Title — two absolutely-positioned lines, visible entire clip.
  const l1 = fitTitle(p.titleLine1, title.fontSize);
  const l2 = fitTitle(p.titleLine2, title.fontSize);
  events.push(
    `Dialogue: 0,0:00:00.00,${end},Title,,0,0,0,,{\\an5\\pos(${TITLE.centerX},${title.line1CenterY})${l1.tag}}${esc(l1.text)}`,
  );
  events.push(
    `Dialogue: 0,0:00:00.00,${end},TitleAccent,,0,0,0,,{\\an5\\pos(${TITLE.centerX},${title.line2CenterY})${l2.tag}}${esc(l2.text)}`,
  );

  // Dialogue subtitles.
  //
  // Split here rather than upstream: the number of lines a cue turns into
  // depends on the font size chosen for THIS render, and the same highlight can
  // be re-rendered at a different size from the result screen.
  if (p.subtitles.enabled) {
    for (const c of splitCues(p.cues, p.subtitles.size)) {
      const s = Math.max(0, c.start);
      const e = Math.min(p.clipDurationSec, c.end);
      if (e <= s) continue;
      events.push(`Dialogue: 0,${sec2ass(s)},${sec2ass(e)},Sub,,0,0,0,,${esc(c.text)}`);
    }
  }

  // Church name — shown for the whole clip, like the title.
  if (church) {
    events.push(`Dialogue: 0,0:00:00.00,${end},Church,,0,0,0,,${esc(church)}`);
  }

  return `${header}\n${events.join("\n")}\n`;
}

// Shrink title font (via \fscx/\fscy) if the line is too wide for the canvas.
// How many glyphs fit depends on the font size, so a bigger title must start
// shrinking sooner — otherwise "아주 크게" runs off both screen edges.
function fitTitle(text: string, fontSize: number): { text: string; tag: string } {
  const len = [...text].length;
  // ~10 Korean glyphs fill maxTextWidth(900) at the default size of 116.
  const maxGlyphs = 10 * (TITLE.fontSize / fontSize);
  if (len <= maxGlyphs) return { text, tag: "" };
  const scale = Math.max(
    (TITLE.minFontSize / fontSize) * 100,
    Math.floor((maxGlyphs / len) * 100),
  );
  return { text, tag: `\\fscx${scale}\\fscy${scale}` };
}
