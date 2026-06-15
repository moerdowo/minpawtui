import { fg } from "@opentui/core";
import type { TextChunk } from "@opentui/core";

/**
 * Winamp-style spectrum, rendered as a fine Braille dot-matrix.
 *
 * Each terminal cell is a 2×4 Braille dot grid, so a single dot is ~1/8 of a
 * character — the smallest "pixel" a terminal can draw. `renderBraille()`
 * packs the bars into that grid; the bar levels come from a real FFT
 * (Analyzer) when the backend can tap the audio, or a synthetic model
 * otherwise.
 */

// Braille dot bit per (subRow 0..3, subCol 0..1). U+2800 + bitmask = glyph.
const BRAILLE_BASE = 0x2800;
const BRAILLE_BITS: readonly (readonly number[])[] = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
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
   * Render the spectrum as a fine Braille dot-matrix.
   *
   * The display is `cellW × cellH` terminal cells, i.e. a (2·cellW)×(4·cellH)
   * grid of dots. There is one bar per dot-column (so `bandCount` must be
   * 2·cellW); each bar fills dots from the bottom up, with a slowly-falling
   * peak dot. `rowColors[cy]` colors cell-row `cy` (top → bottom gradient).
   *
   * Returns one `TextChunk[]` per cell-row, top-down.
   */
  renderBraille(
    cellW: number,
    cellH: number,
    rowColors: string[],
    emptyColor: string,
  ): TextChunk[][] {
    const dotCols = cellW * 2;
    const dotRows = cellH * 4;
    if (this._bands !== dotCols) this.resize(dotCols);

    const out: TextChunk[][] = [];
    for (let cy = 0; cy < cellH; cy++) {
      const color = rowColors[cy] ?? rowColors[rowColors.length - 1] ?? "#0bff5a";
      const chunks: TextChunk[] = [];
      for (let cx = 0; cx < cellW; cx++) {
        let bits = 0;
        for (let sr = 0; sr < 4; sr++) {
          for (let sc = 0; sc < 2; sc++) {
            const c = cx * 2 + sc;
            const h = Math.round(this.levels[c]! * dotRows);
            const pk = Math.round(this.peaks[c]! * dotRows);
            const dotFromBottom = dotRows - 1 - (cy * 4 + sr);
            const lit = dotFromBottom < h;
            const isPeak =
              !lit &&
              pk > 0 &&
              dotFromBottom === pk - 1 &&
              this.peaks[c]! > this.levels[c]! + 0.04;
            if (lit || isPeak) bits |= BRAILLE_BITS[sr]![sc]!;
          }
        }
        const ch = String.fromCodePoint(BRAILLE_BASE + bits);
        chunks.push(fg(bits === 0 ? emptyColor : color)(ch));
      }
      out.push(chunks);
    }
    return out;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
