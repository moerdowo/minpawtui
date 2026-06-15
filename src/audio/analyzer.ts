/**
 * Real-time spectrum analyzer: a radix-2 Cooley-Tukey FFT over a ring buffer
 * of mono PCM samples tapped from the audio pipeline. Produces per-band
 * magnitudes in [0,1] using log-spaced frequency bands, a power spectrum,
 * and dB scaling — the same DSP a hardware spectrum analyzer uses.
 *
 * The player pushes the samples it is about to play into `pushMono()`; the
 * UI calls `computeBands()` on its render tick. No external dependencies.
 */

const TWO_PI = Math.PI * 2;

/** Per-band level floor in dB. A band quieter than this reads as empty (0). */
const FLOOR_DB = -55;

export class Analyzer {
  readonly sampleRate: number;
  readonly fftSize: number;
  private ring: Float32Array;
  private writePos = 0;
  private filled = 0;

  // Reusable scratch buffers (no per-frame allocation).
  private re: Float64Array;
  private im: Float64Array;
  private window: Float64Array;
  private cosTable: Float64Array;
  private sinTable: Float64Array;
  private bitRev: Uint32Array;
  private prevBands: number[] = [];

  constructor(sampleRate = 44100, fftSize = 2048) {
    if ((fftSize & (fftSize - 1)) !== 0) {
      throw new Error("fftSize must be a power of 2");
    }
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.ring = new Float32Array(fftSize);
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);

    // Hann window reduces spectral leakage.
    this.window = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / (fftSize - 1));
    }

    // Precomputed twiddle factors for an fftSize-point transform.
    const half = fftSize >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      this.cosTable[k] = Math.cos((-TWO_PI * k) / fftSize);
      this.sinTable[k] = Math.sin((-TWO_PI * k) / fftSize);
    }

    // Bit-reversal permutation table.
    this.bitRev = new Uint32Array(fftSize);
    const bits = Math.log2(fftSize);
    for (let i = 0; i < fftSize; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.bitRev[i] = r;
    }
  }

  /** Push mono samples (already L/R averaged) into the ring buffer. */
  pushMono(samples: Float32Array): void {
    const n = samples.length;
    const size = this.fftSize;
    if (n >= size) {
      // Only the last `size` samples matter.
      this.ring.set(samples.subarray(n - size));
      this.writePos = 0;
      this.filled = size;
      return;
    }
    for (let i = 0; i < n; i++) {
      this.ring[this.writePos] = samples[i]!;
      this.writePos = (this.writePos + 1) % size;
    }
    this.filled = Math.min(size, this.filled + n);
  }

  /** Mono-mix interleaved stereo f32 and push it. */
  pushStereoInterleaved(stereo: Float32Array): void {
    const frames = stereo.length >> 1;
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      mono[i] = (stereo[i * 2]! + stereo[i * 2 + 1]!) * 0.5;
    }
    this.pushMono(mono);
  }

  /** Clear accumulated samples (e.g. on seek/stop). */
  reset(): void {
    this.ring.fill(0);
    this.writePos = 0;
    this.filled = 0;
    this.prevBands = [];
  }

  /**
   * Compute `bandCount` log-spaced magnitude bands in [0,1].
   * `decay` lets callers fade bands toward zero when not enough fresh
   * audio is available (silence). Returns a fresh array each call.
   */
  computeBands(
    bandCount: number,
    minHz = 40,
    maxHz = 16000,
  ): number[] {
    const size = this.fftSize;
    const bands = new Array<number>(bandCount).fill(0);
    if (this.prevBands.length !== bandCount) {
      this.prevBands = new Array<number>(bandCount).fill(0);
    }

    // Copy ring (oldest → newest) into re[], apply window; im[] = 0.
    const start = this.writePos; // oldest sample (ring is full in steady state)
    let maxAbs = 0;
    for (let i = 0; i < size; i++) {
      const s = this.ring[(start + i) % size]!;
      const a = s < 0 ? -s : s;
      if (a > maxAbs) maxAbs = a;
      this.re[i] = s * this.window[i]!;
      this.im[i] = 0;
    }

    // Silence → decay previous bands toward zero.
    if (maxAbs < 1e-5) {
      for (let b = 0; b < bandCount; b++) {
        const v = this.prevBands[b]! * 0.8;
        bands[b] = v;
        this.prevBands[b] = v;
      }
      return bands;
    }

    this.fft();

    // Power spectrum and log-spaced band aggregation.
    const half = size >> 1;
    const binHz = this.sampleRate / size;
    const logMin = Math.log(minHz);
    const logMax = Math.log(maxHz);

    // Normalize FFT magnitude to be amplitude-referenced and size-independent.
    // A Hann window has coherent gain ~0.5, and an N-point FFT scales a bin by
    // ~N/2, so dividing by N/4 makes a full-scale sine read ~1.0 (0 dB) in its
    // bin regardless of fftSize. Without this the raw magnitudes scale with N
    // and every band saturates to max.
    const magNorm = 4 / size;

    for (let b = 0; b < bandCount; b++) {
      const f0 = Math.exp(logMin + ((logMax - logMin) * b) / bandCount);
      const f1 = Math.exp(logMin + ((logMax - logMin) * (b + 1)) / bandCount);
      let bin0 = Math.max(1, Math.floor(f0 / binHz));
      let bin1 = Math.min(half - 1, Math.ceil(f1 / binHz));
      if (bin1 < bin0) bin1 = bin0;

      let sumPow = 0;
      let count = 0;
      for (let k = bin0; k <= bin1; k++) {
        const reK = this.re[k]! * magNorm;
        const imK = this.im[k]! * magNorm;
        sumPow += reK * reK + imK * imK; // normalized power
        count++;
      }
      const rms = count > 0 ? Math.sqrt(sumPow / count) : 0;

      // Map dB [FLOOR_DB .. 0] → [0 .. 1]. FLOOR_DB sets how quiet a band has
      // to get before it reads as empty; typical music lands well inside.
      let v = 0;
      if (rms > 1e-7) v = (20 * Math.log10(rms) - FLOOR_DB) / -FLOOR_DB;
      v = v < 0 ? 0 : v > 1 ? 1 : v;

      // Fast attack, slow decay temporal smoothing.
      const prev = this.prevBands[b]!;
      v = v > prev ? v * 0.6 + prev * 0.4 : v * 0.3 + prev * 0.7;
      bands[b] = v;
      this.prevBands[b] = v;
    }

    return bands;
  }

  /** In-place iterative radix-2 FFT on re[]/im[] using precomputed tables. */
  private fft(): void {
    const n = this.fftSize;
    const re = this.re;
    const im = this.im;
    const rev = this.bitRev;

    // Bit-reversal reorder.
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
        const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
      }
    }

    // Butterfly stages using the shared twiddle table.
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        let kt = 0;
        for (let k = 0; k < half; k++) {
          const cos = this.cosTable[kt]!;
          const sin = this.sinTable[kt]!;
          const i0 = start + k;
          const i1 = i0 + half;
          const tr = re[i1]! * cos - im[i1]! * sin;
          const ti = re[i1]! * sin + im[i1]! * cos;
          re[i1] = re[i0]! - tr;
          im[i1] = im[i0]! - ti;
          re[i0] = re[i0]! + tr;
          im[i0] = im[i0]! + ti;
          kt += step;
        }
      }
    }
  }
}
