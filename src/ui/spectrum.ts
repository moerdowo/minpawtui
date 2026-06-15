import { bg, fg } from "@opentui/core";
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

  /**
   * Advance the visualizer. When `realBands` is supplied (a real FFT of the
   * audio, length === band count), the bars follow it directly. Otherwise the
   * synthetic oscillator model drives them. Either way `playing === false`
   * decays everything to silence.
   */
  tick(dt: number, playing: boolean, realBands?: number[] | null): void {
    if (!playing) {
      for (let i = 0; i < this._bands; i++) {
        this.levels[i]! *= 0.82;
        this.peaks[i] = Math.max(this.levels[i]!, this.peaks[i]! - dt * 0.6);
        if (this.levels[i]! < 0.001) this.levels[i] = 0;
        if (this.peaks[i]! < 0.001) this.peaks[i] = 0;
      }
      return;
    }

    if (realBands && realBands.length === this._bands) {
      for (let i = 0; i < this._bands; i++) {
        this.levels[i] = clamp01(realBands[i]!);
        const pk = this.peaks[i]!;
        if (this.levels[i]! > pk) this.peaks[i] = this.levels[i]!;
        else this.peaks[i] = Math.max(this.levels[i]!, pk - dt * 0.35);
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
   * Classic Winamp stacking-brick visualizer with 1:1 brick aspect.
   *
   * Each terminal cell encodes TWO brick levels via half-block glyphs:
   *   ▀ = upper-half lit, fg colors the top brick, bg colors the bottom
   *   ▄ = lower-half lit, fg colors the bottom brick (top is empty)
   *   █ = full cell (both halves lit, single fg)
   *   ' ' = empty cell
   * Terminal cells are roughly 1:2 (W:H), so a half-cell tall block is
   * approximately square — each "brick piece" is 1:1.
   *
   * `levelColors` must have `terminalRows * 2` entries, top-down.
   * A 1-char gap between bars gives vertical mortar; the natural cell
   * boundary between terminal rows gives horizontal mortar.
   */
  renderBricks(
    bars: number,
    terminalRows: number,
    levelColors: string[],
    emptyColor: string,
  ): TextChunk[][] {
    if (this._bands !== bars) this.resize(bars);
    const totalLevels = terminalRows * 2;
    const out: TextChunk[][] = [];

    for (let tr = 0; tr < terminalRows; tr++) {
      const upperLevel = tr * 2;
      const lowerLevel = tr * 2 + 1;
      const upperColor =
        levelColors[upperLevel] ?? levelColors[levelColors.length - 1] ?? "#fff";
      const lowerColor =
        levelColors[lowerLevel] ?? levelColors[levelColors.length - 1] ?? "#fff";
      const chunks: TextChunk[] = [];

      for (let b = 0; b < bars; b++) {
        const upper = brickStateAt(this, b, upperLevel, totalLevels);
        const lower = brickStateAt(this, b, lowerLevel, totalLevels);
        const upperOn = upper !== "empty";
        const lowerOn = lower !== "empty";

        if (upperOn && lowerOn) {
          // Two coloured bricks share a cell. ▀ paints fg on top half and
          // bg on the bottom — that's both pieces in one character.
          chunks.push(bg(lowerColor)(fg(upperColor)("▀")));
        } else if (upperOn) {
          chunks.push(bg(emptyColor)(fg(upperColor)("▀")));
        } else if (lowerOn) {
          chunks.push(bg(emptyColor)(fg(lowerColor)("▄")));
        } else {
          chunks.push(fg(emptyColor)(" "));
        }

        if (b < bars - 1) chunks.push(fg(emptyColor)(" "));
      }
      out.push(chunks);
    }
    return out;
  }
}

type BrickState = "lit" | "peak" | "empty";

function brickStateAt(
  spec: Spectrum,
  bar: number,
  brickLevel: number,
  totalLevels: number,
): BrickState {
  // We can read private fields because we're in the same module.
  const level = (spec as any).levels[bar] as number;
  const peak = (spec as any).peaks[bar] as number;
  const barHeight = Math.max(
    0,
    Math.min(totalLevels, Math.round(level * totalLevels)),
  );
  const peakAt = Math.max(
    0,
    Math.min(totalLevels, Math.round(peak * totalLevels)),
  );
  const distFromBottom = totalLevels - 1 - brickLevel;
  if (distFromBottom < barHeight) return "lit";
  if (peakAt > 0 && distFromBottom === peakAt - 1 && peak > level + 0.05) {
    return "peak";
  }
  return "empty";
}

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
