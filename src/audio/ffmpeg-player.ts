import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Track } from "../types.ts";
import { Analyzer } from "./analyzer.ts";
import type { Player, PlayerBackend, PlayerEvents } from "./player.ts";

/**
 * In-process audio backend: ffmpeg decodes the file to raw PCM, our process
 * meters that PCM out to an ffplay "DAC" at exactly real-time byte-rate, and
 * taps every sample on the way through for a real FFT spectrum.
 *
 * Because WE are the clock (ffplay greedily buffers, so we can't rely on its
 * backpressure), position / pause / seek are driven by our own byte counter:
 *   - position  = seekBase + bytesOut / byteRate
 *   - pause     = stop metering + SIGSTOP both procs (freezes audio + memory)
 *   - seek      = kill + respawn ffmpeg with -ss, fresh ffplay, reset clocks
 *   - volume    = scale f32 samples in the pump (post-tap, so the viz is
 *                 independent of volume — matching classic analyzers)
 *   - ended     = ffmpeg EOF + queue drained → end ffplay stdin → it exits
 */

const SR = 44100;
const CH = 2;
const BPS = 4; // bytes per f32 sample
const FRAME = CH * BPS; // bytes per stereo frame
const BYTE_RATE = SR * FRAME; // real-time bytes/sec
const TICK_MS = 20;
const QUEUE_HIGH = BYTE_RATE * 2; // pause decode above ~2s buffered
const QUEUE_LOW = BYTE_RATE; // resume decode below ~1s buffered

export class FfmpegTapPlayer extends EventEmitter implements Player {
  readonly backend: PlayerBackend = "ffmpeg-tap";

  private analyzer = new Analyzer(SR, 2048);
  private currentTrack: Track | null = null;
  private status: "stopped" | "playing" | "paused" = "stopped";
  private volume = 80;

  private ffmpeg: ChildProcess | null = null;
  private ffplay: ChildProcess | null = null;

  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private ffmpegDone = false;
  private endedSignalled = false;
  private manualStop = false;

  // Clocks
  private seekBase = 0; // seconds the current ffmpeg was spawned at (-ss)
  private bytesOut = 0; // bytes metered to ffplay since spawn
  private elapsedPlaying = 0; // accumulated playing seconds (excludes pauses)
  private lastResumeWall = 0; // Date.now() at last resume
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private lastEmittedPos = -1;

  /* ----------------------------- lifecycle ----------------------------- */

  async load(track: Track): Promise<void> {
    this.manualStop = true;
    this.teardownProcs();
    this.manualStop = false;

    this.currentTrack = track;
    this.analyzer.reset();
    this.spawnFrom(0);
    this.status = "playing";
    this.emit("started", track);
  }

  private spawnFrom(positionSec: number): void {
    this.teardownProcs();

    this.seekBase = Math.max(0, positionSec);
    this.bytesOut = 0;
    this.elapsedPlaying = 0;
    this.lastResumeWall = Date.now();
    this.queue = [];
    this.queuedBytes = 0;
    this.ffmpegDone = false;
    this.endedSignalled = false;

    const track = this.currentTrack;
    if (!track) return;

    const ssArgs = this.seekBase > 0 ? ["-ss", this.seekBase.toFixed(3)] : [];
    this.ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error",
        ...ssArgs,
        "-i", track.path,
        "-f", "f32le", "-acodec", "pcm_f32le",
        "-ar", String(SR), "-ac", String(CH),
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    this.ffplay = spawn(
      "ffplay",
      [
        "-hide_banner", "-loglevel", "error", "-nodisp", "-autoexit",
        "-f", "f32le", "-ar", String(SR), "-ch_layout", "stereo", "-i", "pipe:0",
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );

    const ffmpeg = this.ffmpeg;
    const ffplay = this.ffplay;

    ffmpeg.on("error", (err) => this.emit("error", err));
    ffplay.on("error", (err) => this.emit("error", err));

    ffmpeg.stdout?.on("data", (chunk: Buffer) => {
      this.queue.push(chunk);
      this.queuedBytes += chunk.byteLength;
      if (this.queuedBytes > QUEUE_HIGH) ffmpeg.stdout?.pause();
    });
    ffmpeg.stdout?.on("end", () => {
      this.ffmpegDone = true;
    });

    // Swallow EPIPE when we kill ffplay mid-write.
    ffplay.stdin?.on("error", () => {});

    ffplay.on("exit", () => {
      if (this.manualStop) return;
      if (ffplay !== this.ffplay) return; // superseded by a newer spawn
      // Natural end: ffplay drained its buffer and exited.
      if (this.ffmpegDone && this.queuedBytes === 0) this.signalEnded();
    });

    this.startMeter();
  }

  private startMeter(): void {
    this.stopMeter();
    this.meterTimer = setInterval(() => this.meterTick(), TICK_MS);
  }

  private stopMeter(): void {
    if (this.meterTimer) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
  }

  /** Meter PCM to ffplay locked to wall-clock; tap each chunk for the FFT. */
  private meterTick(): void {
    if (this.status !== "playing") return;

    // Self-correcting against timer drift: target bytes = elapsed playing time.
    const now = Date.now();
    const elapsed = this.elapsedPlaying + (now - this.lastResumeWall) / 1000;
    let targetBytes = Math.floor((elapsed * BYTE_RATE) / FRAME) * FRAME;
    let toSend = targetBytes - this.bytesOut;
    if (toSend <= 0) {
      this.maybeResumeDecode();
      return;
    }

    const buf = this.takeFromQueue(toSend);
    if (buf && buf.byteLength) {
      // TAP (pre-volume): feed the analyzer exactly what we're about to play.
      this.analyzer.pushStereoInterleaved(
        new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2),
      );
      // Apply volume in-place (post-tap) then hand off to the DAC.
      this.applyVolume(buf);
      this.bytesOut += buf.byteLength;
      this.ffplay?.stdin?.write(buf);
      this.emitPositionMaybe();
    } else if (this.ffmpegDone && this.queuedBytes === 0) {
      // All decoded audio metered out — close the DAC so it drains and exits.
      this.ffplay?.stdin?.end();
    }

    this.maybeResumeDecode();
  }

  private maybeResumeDecode(): void {
    if (this.queuedBytes < QUEUE_LOW) this.ffmpeg?.stdout?.resume();
  }

  private applyVolume(buf: Buffer): void {
    const v = this.volume / 100;
    if (v === 1) return;
    const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
    for (let i = 0; i < f.length; i++) f[i] = f[i]! * v;
  }

  private takeFromQueue(n: number): Buffer | null {
    if (this.queuedBytes === 0) return null;
    const want = Math.min(n, this.queuedBytes);
    const out = Buffer.allocUnsafe(want);
    let off = 0;
    while (off < want && this.queue.length) {
      const head = this.queue[0]!;
      const need = want - off;
      if (head.byteLength <= need) {
        head.copy(out, off);
        off += head.byteLength;
        this.queue.shift();
        this.queuedBytes -= head.byteLength;
      } else {
        head.copy(out, off, 0, need);
        off += need;
        this.queue[0] = head.subarray(need);
        this.queuedBytes -= need;
      }
    }
    return out.subarray(0, off);
  }

  private emitPositionMaybe(): void {
    const pos = this.getPosition();
    if (Math.abs(pos - this.lastEmittedPos) >= 0.2) {
      this.lastEmittedPos = pos;
      this.emit("positionChange", pos);
    }
  }

  private signalEnded(): void {
    if (this.endedSignalled) return;
    this.endedSignalled = true;
    this.status = "stopped";
    this.stopMeter();
    this.emit("ended");
  }

  /* ----------------------------- controls ------------------------------ */

  async play(): Promise<void> {
    if (this.status === "playing") return;
    if (this.status === "paused") {
      this.signalContinue("SIGCONT");
      this.lastResumeWall = Date.now();
      this.status = "playing";
      this.startMeter();
      this.emit("resumed");
      return;
    }
    // stopped → restart current track from the beginning
    if (this.currentTrack) {
      this.analyzer.reset();
      this.spawnFrom(0);
      this.status = "playing";
      this.emit("started", this.currentTrack);
    }
  }

  async pause(): Promise<void> {
    if (this.status !== "playing") return;
    this.elapsedPlaying += (Date.now() - this.lastResumeWall) / 1000;
    this.status = "paused";
    this.stopMeter();
    this.signalContinue("SIGSTOP"); // freeze audio + decode (bounds memory)
    this.emit("paused");
  }

  async togglePause(): Promise<void> {
    if (this.status === "playing") await this.pause();
    else if (this.status === "paused") await this.play();
  }

  async stop(): Promise<void> {
    this.manualStop = true;
    this.teardownProcs();
    this.manualStop = false;
    this.analyzer.reset();
    this.status = "stopped";
    this.seekBase = 0;
    this.bytesOut = 0;
    this.elapsedPlaying = 0;
    this.lastEmittedPos = -1;
    this.emit("stopped");
  }

  async seek(deltaSec: number): Promise<void> {
    await this.seekAbs(this.getPosition() + deltaSec);
  }

  async seekAbs(positionSec: number): Promise<void> {
    if (!this.currentTrack) return;
    const dur = this.currentTrack.durationSec || Infinity;
    const target = Math.max(0, Math.min(dur, positionSec));
    const wasPaused = this.status === "paused";
    this.manualStop = true;
    this.teardownProcs();
    this.manualStop = false;
    this.analyzer.reset();
    this.spawnFrom(target);
    this.status = "playing";
    if (wasPaused) await this.pause();
    this.emit("positionChange", this.getPosition());
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(100, Math.round(volume)));
    // Applied live in the meter — no respawn needed.
    this.emit("volumeChange", this.volume);
  }

  /* ------------------------------ queries ------------------------------ */

  getPosition(): number {
    return this.seekBase + this.bytesOut / BYTE_RATE;
  }
  getDuration(): number {
    return this.currentTrack?.durationSec ?? 0;
  }
  isPlaying(): boolean {
    return this.status === "playing";
  }
  isPaused(): boolean {
    return this.status === "paused";
  }

  getBands(count: number): number[] | null {
    return this.analyzer.computeBands(count);
  }

  /* ----------------------------- teardown ------------------------------ */

  private signalContinue(sig: "SIGSTOP" | "SIGCONT"): void {
    try {
      this.ffmpeg?.kill(sig);
    } catch {
      /* ignore */
    }
    try {
      this.ffplay?.kill(sig);
    } catch {
      /* ignore */
    }
  }

  private teardownProcs(): void {
    this.stopMeter();
    const ffmpeg = this.ffmpeg;
    const ffplay = this.ffplay;
    this.ffmpeg = null;
    this.ffplay = null;
    // If currently suspended, continue first so SIGKILL is delivered.
    try {
      ffmpeg?.kill("SIGCONT");
    } catch {
      /* ignore */
    }
    try {
      ffplay?.kill("SIGCONT");
    } catch {
      /* ignore */
    }
    try {
      ffmpeg?.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      ffplay?.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }

  async destroy(): Promise<void> {
    this.manualStop = true;
    this.teardownProcs();
  }

  override on<E extends keyof PlayerEvents>(event: E, listener: PlayerEvents[E]): this {
    return super.on(event, listener as (...args: any[]) => void);
  }
  override off<E extends keyof PlayerEvents>(event: E, listener: PlayerEvents[E]): this {
    return super.off(event, listener as (...args: any[]) => void);
  }
}
