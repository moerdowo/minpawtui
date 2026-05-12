import { fg } from "@opentui/core";
import type { TextChunk } from "@opentui/core";
import { theme } from "../theme.ts";

/**
 * Classic Winamp-style spectrum simulator.
 *
 * Playback runs in an external mpv/ffplay/afplay process, so we don't
 * have access to the audio output buffer for a real FFT. Bars are driven
 * by a synthetic signal — per-band oscillators with different periods
 * plus envelope, noise, and occasional "beat" spikes on bass bands.
 *
 * `renderInline()` returns colored TextChunks for a single-row, packed
 * bar display using 1/8 sub-block characters for vertical resolution.
 */

const SUB_BLOCKS: readonly string[] = [
  " ",
  "▁",
  "▂",
  "▃",
  "▄",
  "▅",
  "▆",
  "▇",
  "█",
];

export class Spectrum {
  private _bands: number;
  private levels: number[];
  private peaks: number[];
  private time = 0;
  private beatTimer = 0;

  constructor(bands: number) {
    this._bands = bands;
    this.levels = new Array(bands).fill(0);
    this.peaks = new Array(bands).fill(0);
  }

  resize(bands: number): void {
    if (bands === this._bands) return;
    const prevLevels = this.levels;
    const prevPeaks = this.peaks;
    const prevBands = this._bands;
    this._bands = bands;
    this.levels = new Array(bands).fill(0);
    this.peaks = new Array(bands).fill(0);
    for (let i = 0; i < bands; i++) {
      const srcIdx = Math.min(
        prevBands - 1,
        Math.floor((i / bands) * prevBands),
      );
      this.levels[i] = prevLevels[srcIdx] ?? 0;
      this.peaks[i] = prevPeaks[srcIdx] ?? 0;
    }
  }

  tick(dt: number, playing: boolean): void {
    if (!playing) {
      for (let i = 0; i < this._bands; i++) {
        this.levels[i]! *= 0.82;
        this.peaks[i] = Math.max(this.levels[i]!, this.peaks[i]! - dt * 0.6);
        if (this.levels[i]! < 0.001) this.levels[i] = 0;
        if (this.peaks[i]! < 0.001) this.peaks[i] = 0;
      }
      return;
    }

    this.time += dt;
    this.beatTimer -= dt;
    const isBeat = this.beatTimer <= 0;
    if (isBeat) this.beatTimer = 0.22 + Math.random() * 0.45;

    for (let i = 0; i < this._bands; i++) {
      const norm = i / Math.max(1, this._bands - 1);
      const bandBias = 1.0 - norm * 0.55;
      const phase = i * 0.37;
      const oscFast = Math.sin(this.time * 6.0 + phase) * 0.22;
      const oscMid = Math.sin(this.time * 2.3 + phase * 1.7) * 0.32;
      const oscSlow = Math.sin(this.time * 0.9 + phase * 0.6 + 1.3) * 0.28;
      const envelope = (oscFast + oscMid + oscSlow) * 0.5 + 0.5;
      const beatSpike = isBeat && norm < 0.45 ? Math.random() * 0.4 : 0;
      const noise = (Math.random() - 0.5) * 0.12;
      const target = clamp01(envelope * bandBias + beatSpike + noise);

      const cur = this.levels[i]!;
      const dir = target - cur;
      const speed = dir > 0 ? 0.55 : 0.18;
      this.levels[i] = cur + dir * speed;

      const pk = this.peaks[i]!;
      if (this.levels[i]! > pk) this.peaks[i] = this.levels[i]!;
      else this.peaks[i] = Math.max(this.levels[i]!, pk - dt * 0.35);
    }
  }

  /**
   * Returns colored chunks for a single-row inline visualizer of the
   * given width. Each character represents one bar; its color reflects
   * the bar's instantaneous level (green→amber→red) for a classic
   * Winamp gradient even in 1-row mode.
   */
  renderInline(width: number): TextChunk[] {
    if (this._bands !== width) this.resize(width);
    const chunks: TextChunk[] = [];
    for (let b = 0; b < width; b++) {
      const sub = clamp(Math.round(this.levels[b]! * 8), 0, 8);
      const ch = SUB_BLOCKS[sub]!;
      chunks.push(fg(colorForLevel(sub))(ch));
    }
    return chunks;
  }

  /**
   * Classic Winamp stacking-brick visualizer. Returns one TextChunk[]
   * per row, top-down. Each bar is a column of brick cells (▆); the
   * brick character is 3/4 height so the top 1/4 of every cell shows
   * through as horizontal "mortar" between rows. A 1-char gap between
   * bars provides vertical mortar. Bars fill from the bottom; a
   * floating peak indicator marks the recent maximum and decays slowly.
   */
  renderBricks(
    bars: number,
    rows: number,
    rowColors: string[],
    spacerColor: string,
  ): TextChunk[][] {
    if (this._bands !== bars) this.resize(bars);
    const out: TextChunk[][] = [];
    for (let r = 0; r < rows; r++) {
      const chunks: TextChunk[] = [];
      const distFromBottom = rows - 1 - r;
      const color = rowColors[r] ?? rowColors[rowColors.length - 1] ?? "#0bff5a";
      for (let b = 0; b < bars; b++) {
        const level = this.levels[b]!;
        const peak = this.peaks[b]!;
        const barHeight = Math.max(
          0,
          Math.min(rows, Math.round(level * rows)),
        );
        const peakRow = Math.max(
          0,
          Math.min(rows, Math.round(peak * rows)),
        );
        const lit = distFromBottom < barHeight;
        const peakLit =
          !lit &&
          peakRow > 0 &&
          distFromBottom === peakRow - 1 &&
          peak > level + 0.05;
        if (lit) {
          chunks.push(fg(color)(BRICK));
        } else if (peakLit) {
          chunks.push(fg(color)(BRICK_CAP));
        } else {
          chunks.push(fg(spacerColor)(" "));
        }
        if (b < bars - 1) chunks.push(fg(spacerColor)(" "));
      }
      out.push(chunks);
    }
    return out;
  }
}

const BRICK = "▆";
const BRICK_CAP = "▔";

function colorForLevel(sub: number): string {
  if (sub <= 3) return theme.lcd;
  if (sub <= 6) return theme.amber;
  return theme.red;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
