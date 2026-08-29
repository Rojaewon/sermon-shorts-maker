// Layout constants — MEASURED pixel-for-pixel from the two sample videos
// (설교쇼츠 (1).mp4 dark, 설교쇼츠 (2).mp4 light). Do not eyeball; these are the spec.
//
// Canvas 1080x1920, split exactly 25% / 50% / 25%:
//   title band  y 0    - 479   (480px)
//   video       y 480  - 1439  (960px, 1080x960 = 9:8, center-cropped)
//   subtitle    y 1440 - 1919  (480px)

import type { SubtitlePosition, SubtitleSize, TemplateId, TitleSize } from "./types";

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

export const TITLE_BAND = { top: 0, height: 480 };
export const VIDEO_BAND = { top: 480, height: 960 };
export const SUB_BAND = { top: 1440, height: 480 };

// Title text (measured): line1 y≈197-287, line2 y≈313-402, glyph height ≈90, gap ≈26.
// We render title centered in the top band.
export const TITLE = {
  centerX: CANVAS_W / 2, // 540
  line1CenterY: 242, // (197+287)/2
  line2CenterY: 357, // (313+402)/2
  fontSize: 116, // tuned so glyph height ≈90 (measured render at 96 gave ~72)
  maxTextWidth: 900, // observed max 727; keep 90px side margins
  minFontSize: 56,
};

// Derived from the measurements above: the two lines sit 115px apart, and their
// block is centred on y=299.5 (notably NOT the band's own centre of 240 — the
// samples leave more air above the title than below).
const TITLE_BLOCK_CENTER_Y = (TITLE.line1CenterY + TITLE.line2CenterY) / 2; // 299.5
const TITLE_LINE_GAP = TITLE.line2CenterY - TITLE.line1CenterY; // 115

export const TITLE_FONT_SIZE: Record<TitleSize, number> = {
  small: 88,
  medium: TITLE.fontSize, // 116 — the measured default
  large: 142,
  xlarge: 168,
};

// Line spacing has to grow with the font, or bigger titles collide: at size 168
// a glyph is ~130px tall but the measured gap is only 115. Scaling the gap by
// the same factor keeps the block centred and inside the 480px band.
export function titlePlacement(size: TitleSize = "medium"): {
  fontSize: number;
  line1CenterY: number;
  line2CenterY: number;
} {
  const fontSize = TITLE_FONT_SIZE[size];
  const gap = TITLE_LINE_GAP * (fontSize / TITLE.fontSize);
  return {
    fontSize,
    line1CenterY: Math.round(TITLE_BLOCK_CENTER_Y - gap / 2),
    line2CenterY: Math.round(TITLE_BLOCK_CENTER_Y + gap / 2),
  };
}

// Swatches offered for title colors. Chosen to stay legible on both the black
// and the cream template background.
export const TITLE_COLOR_PRESETS: { hex: string; label: string }[] = [
  { hex: "#FFFFFF", label: "흰색" },
  { hex: "#FFFF5A", label: "노랑" },
  { hex: "#FF9F1C", label: "주황" },
  { hex: "#C1392B", label: "빨강" },
  { hex: "#4DA6FF", label: "파랑" },
  { hex: "#3DD68C", label: "초록" },
  { hex: "#1B243D", label: "남색" },
  { hex: "#000000", label: "검정" },
];

export interface Template {
  id: TemplateId;
  label: string;
  bg: string; // hex, used as ffmpeg pad color and ASS背景
  titleLine1: string; // hex
  titleLine2: string; // hex (accent)
  subtitle: string; // hex — subtitle text color
  subtitleOutline: string; // hex — subtitle outline
}

export const TEMPLATES: Record<TemplateId, Template> = {
  dark: {
    id: "dark",
    label: "기본 (다크)",
    bg: "#000000",
    titleLine1: "#FFFFFF",
    titleLine2: "#FFFF5A",
    subtitle: "#FFFFFF",
    subtitleOutline: "#000000",
  },
  light: {
    id: "light",
    label: "라이트",
    bg: "#F2EEE6",
    titleLine1: "#1B243D",
    titleLine2: "#C1392B",
    subtitle: "#1B243D",
    subtitleOutline: "#F2EEE6",
  },
};

// Subtitle font sizes per level (ASS Fontsize, canvas-relative).
export const SUB_FONT_SIZE: Record<SubtitleSize, number> = {
  small: 46,
  medium: 58,
  large: 70,
  xlarge: 84,
};

// Vertical placement per position preset.
// Returns ASS alignment (numpad) + marginV (px from the aligned edge).
export function subtitlePlacement(pos: SubtitlePosition): {
  alignment: number;
  marginV: number;
} {
  switch (pos) {
    case "band":
      // centered inside bottom band (1440-1919). Anchor bottom, lift up to band center-ish.
      return { alignment: 2, marginV: 190 };
    case "video-under":
      // just under the video (y ~1440), anchor bottom of screen but high margin
      return { alignment: 2, marginV: 430 };
    case "video-bottom":
      // inside the video area, near its bottom edge
      return { alignment: 2, marginV: 500 };
    case "screen-bottom":
      return { alignment: 2, marginV: 70 };
  }
}

// Church name — a small credit line at the very bottom of the subtitle band.
// Deliberately quiet: it identifies the source without competing with the
// message. The samples this layout was measured from had no badge, so these
// values are chosen rather than measured, and verified by rendering.
export const CHURCH = {
  fontSize: 38,
  marginV: 46, // from the bottom edge
  opacityHex: "60", // ASS alpha: 00 opaque, FF invisible
  // Height the label occupies, used to lift bottom-anchored subtitles clear.
  reservedHeight: 96,
};
