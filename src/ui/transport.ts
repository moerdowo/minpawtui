import {
  BoxRenderable,
  StyledText,
  TextRenderable,
  fg,
  type CliRenderer,
  type TextChunk,
} from "@opentui/core";
import { theme } from "../theme.ts";
import type { AppState, PlayerState } from "../types.ts";
import { formatTime, progressBar, statusGlyph, truncate, volumeBar } from "./util.ts";
import { Spectrum } from "./spectrum.ts";

const INLINE_VIZ_WIDTH = 18;

export class Transport {
  readonly root: BoxRenderable;
  readonly spectrum = new Spectrum(INLINE_VIZ_WIDTH);

  private trackText: TextRenderable;
  private detailText: TextRenderable;
  private progressText: TextRenderable;
  private statusText: TextRenderable;
  private lastWidth = 80;
  private lastPlayer: PlayerState | null = null;
  private vizEnabled = true;

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      id: "transport",
      width: "100%",
      height: 6,
      border: true,
      borderStyle: "rounded",
      borderColor: theme.lcd,
      backgroundColor: theme.lcdBg,
      title: " NOW PLAYING ",
      titleAlignment: "left",
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      gap: 0,
    });

    this.trackText = new TextRenderable(renderer, {
      id: "transport-track",
      content: "♪  — nothing loaded —",
      fg: theme.lcd,
    });
    this.detailText = new TextRenderable(renderer, {
      id: "transport-detail",
      content: "",
      fg: theme.lcdDim,
    });
    this.progressText = new TextRenderable(renderer, {
      id: "transport-progress",
      content: "",
      fg: theme.lcd,
    });
    this.statusText = new TextRenderable(renderer, {
      id: "transport-status",
      content: "",
      fg: theme.amber,
    });

    this.root.add(this.trackText);
    this.root.add(this.detailText);
    this.root.add(this.progressText);
    this.root.add(this.statusText);

    this.root.onSizeChange = () => {
      this.lastWidth = this.root.width || this.lastWidth;
    };
  }

  setVizEnabled(enabled: boolean): void {
    this.vizEnabled = enabled;
    if (this.lastPlayer) this.renderProgress(this.lastPlayer);
  }

  isVizEnabled(): boolean {
    return this.vizEnabled;
  }

  /**
   * Advance the visualizer simulation and refresh the progress line.
   * Called by the app's render-tick timer at ~20 fps.
   */
  tickViz(player: PlayerState, dt: number): void {
    this.spectrum.tick(dt, player.status === "playing");
    if (this.vizEnabled) this.renderProgress(player);
  }

  update(state: AppState): void {
    const p = state.player;
    this.lastPlayer = p;
    const track = p.currentTrack;
    const width = Math.max(20, (this.root.width || this.lastWidth) - 4);

    if (track) {
      const titleLine = `♪  ${track.artist} — ${track.title}`;
      this.trackText.content = truncate(titleLine, width);
      const detail = `${track.album}   ·   ${track.filename}`;
      this.detailText.content = truncate(detail, width);
    } else {
      this.trackText.content = "♪  — nothing loaded —";
      this.detailText.content = "press [Enter] in library or playlist to play";
    }

    this.renderProgress(p);

    if (state.statusMessage) {
      this.statusText.content = truncate(`» ${state.statusMessage}`, width);
      this.statusText.fg = theme.amber;
    } else {
      const hint =
        track && p.status === "stopped"
          ? "[Enter] play  [Space] pause/resume  [N]ext  [P]rev"
          : p.status === "paused"
            ? "PAUSED — press [Space] to resume"
            : p.status === "playing"
              ? "[Space] pause  [S] stop  [[ / ] ] seek  [N]ext"
              : "[Tab] focus playlist  [A] add  [Enter] add+play";
      this.statusText.content = truncate(hint, width);
      this.statusText.fg = theme.lcdDim;
    }
  }

  /**
   * Compose the progress row as colored chunks:
   *   [▶]  01:23 / 02:05  ████░░░  VOL ▮▮▮▮▮▯▯  80%  ▆▇▃▅▂▆▇▄▂▃
   * The trailing portion is the inline mini-spectrum, with each bar
   * char colored by its level (low=green, mid=amber, high=red).
   */
  private renderProgress(p: PlayerState): void {
    const innerWidth = Math.max(20, (this.root.width || this.lastWidth) - 4);

    const glyph = statusGlyph(p.status);
    const pos = formatTime(p.positionSec);
    const dur = formatTime(p.durationSec);
    const timeBlock = `[${glyph}]  ${pos} / ${dur}`;
    const volBlock = `VOL ${volumeBar(p.volume, 10)} ${p.volume
      .toString()
      .padStart(3, " ")}%`;

    const leftPart = `${timeBlock}  `;
    const rightPart = `  ${volBlock}`;
    const vizWidth = this.vizEnabled ? INLINE_VIZ_WIDTH : 0;
    const vizGap = this.vizEnabled ? 2 : 0;
    const barWidth = Math.max(
      6,
      innerWidth - leftPart.length - rightPart.length - vizGap - vizWidth,
    );
    const bar = progressBar(p.positionSec, p.durationSec || 1, barWidth);

    const chunks: TextChunk[] = [];
    chunks.push(fg(theme.lcd)(`${leftPart}${bar}${rightPart}`));
    if (this.vizEnabled) {
      chunks.push(fg(theme.lcdBg)(" ".repeat(vizGap)));
      const vizChunks = this.spectrum.renderInline(vizWidth);
      for (const c of vizChunks) chunks.push(c);
    }

    this.progressText.content = new StyledText(chunks);
  }
}
