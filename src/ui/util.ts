export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 1) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + "…";
}

export function padRight(text: string, width: number): string {
  if (text.length >= width) return truncate(text, width);
  return text + " ".repeat(width - text.length);
}

export function progressBar(
  position: number,
  total: number,
  width: number,
  filledChar = "█",
  emptyChar = "░",
): string {
  if (width <= 0) return "";
  if (total <= 0) return emptyChar.repeat(width);
  const ratio = Math.max(0, Math.min(1, position / total));
  const filled = Math.round(width * ratio);
  return filledChar.repeat(filled) + emptyChar.repeat(width - filled);
}

export function volumeBar(volume: number, width = 10): string {
  const ratio = Math.max(0, Math.min(1, volume / 100));
  const filled = Math.round(width * ratio);
  return "▮".repeat(filled) + "▯".repeat(width - filled);
}

export function statusGlyph(status: "stopped" | "playing" | "paused"): string {
  switch (status) {
    case "playing":
      return "▶";
    case "paused":
      return "❚❚";
    case "stopped":
      return "■";
  }
}
