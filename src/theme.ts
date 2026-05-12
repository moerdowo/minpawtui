/**
 * Classic Winamp-inspired color palette.
 * Dark backgrounds, neon green LCD-style text, amber/cyan accents.
 */
export const theme = {
  bg: "#0a0a0a",
  panelBg: "#111111",
  border: "#3a3a3a",
  borderFocused: "#ffcf3f",

  // LCD-style display green
  lcd: "#0bff5a",
  lcdDim: "#0a8a3a",
  lcdBg: "#021406",

  // Accents
  amber: "#ffcf3f",
  amberDim: "#8a6c0d",
  cyan: "#5cd8ff",
  magenta: "#ff5cd8",
  red: "#ff4444",
  white: "#e6e6e6",
  dim: "#6e6e6e",

  // Selection
  selectionBg: "#ffcf3f",
  selectionFg: "#0a0a0a",
  rowAltBg: "#161616",

  // Now playing highlight
  nowPlayingBg: "#1c1206",
  nowPlayingFg: "#ffcf3f",
} as const;

export type Theme = typeof theme;
