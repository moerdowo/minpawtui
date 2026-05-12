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

const BRICK_BARS = 10;
const BRICK_ROWS = 4;
// Each bar = 1 brick char + 1 char gap; last bar has no trailing gap.
const VIZ_COL_WIDTH = BRICK_BARS * 2 - 1;
// Plus a little left margin so it doesn't kiss the volume readout.
const VIZ_COL_TOTAL = VIZ_COL_WIDTH + 2;
// Below this terminal width we hide the viz entirely so the left
// content keeps a usable amount of space.
const MIN_INNER_WIDTH_FOR_VIZ = 60;

const ROW_COLORS = [
  theme.red, // top
  theme.amber, // upper-mid
  theme.lcd, // lower-mid
  theme.lcdDim, // bottom
];

export class Transport {
  readonly root: BoxRenderable;
  readonly spectrum = new Spectrum(BRICK_BARS);

  private leftCol: BoxRenderable;
  private vizCol: BoxRenderable;
  private vizRows: TextRenderable[] = [];

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
      flexDirection: "row",
      paddingLeft: 1,
      paddingRight: 1,
    });

    this.leftCol = new BoxRenderable(renderer, {
      id: "transport-left",
      flexDirection: "column",
      flexGrow: 1,
      backgroundColor: theme.lcdBg,
    });
    this.root.add(this.leftCol);

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

    this.leftCol.add(this.trackText);
    this.leftCol.add(this.detailText);
    this.leftCol.add(this.progressText);
    this.leftCol.add(this.statusText);

    this.vizCol = new BoxRenderable(renderer, {
      id: "transport-viz",
      flexDirection: "column",
      width: VIZ_COL_TOTAL,
      paddingLeft: 2,
      backgroundColor: theme.lcdBg,
    });
    this.root.add(this.vizCol);

    for (let r = 0; r < BRICK_ROWS; r++) {
      const t = new TextRenderable(renderer, {
        id: `transport-viz-row-${r}`,
        content: "",
        fg: ROW_COLORS[r] ?? theme.lcd,
      });
      this.vizRows.push(t);
      this.vizCol.add(t);
    }

    this.root.onSizeChange = () => {
      this.lastWidth = this.root.width || this.lastWidth;
      this.applyVizVisibility();
    };
  }

  setVizEnabled(enabled: boolean): void {
    this.vizEnabled = enabled;
    this.applyVizVisibility();
    if (this.lastPlayer) this.renderProgress(this.lastPlayer);
  }

  isVizEnabled(): boolean {
    return this.vizEnabled;
  }

  /**
   * Advance the visualizer simulation and refresh the brick rows.
   * Called by the app's render-tick timer at ~20 fps.
   */
  tickViz(player: PlayerState, dt: number): void {
    this.spectrum.tick(dt, player.status === "playing");
    if (this.shouldShowViz()) this.renderBricks();
  }

  update(state: AppState): void {
    const p = state.player;
    this.lastPlayer = p;
    const track = p.currentTrack;
    const innerWidth = this.leftInnerWidth();

    if (track) {
      const titleLine = `♪  ${track.artist} — ${track.title}`;
      this.trackText.content = truncate(titleLine, innerWidth);
      const detail = `${track.album}   ·   ${track.filename}`;
      this.detailText.content = truncate(detail, innerWidth);
    } else {
      this.trackText.content = "♪  — nothing loaded —";
      this.detailText.content = "press [Enter] in library or playlist to play";
    }

    this.renderProgress(p);

    if (state.statusMessage) {
      this.statusText.content = truncate(`» ${state.statusMessage}`, innerWidth);
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
      this.statusText.content = truncate(hint, innerWidth);
      this.statusText.fg = theme.lcdDim;
    }

    this.applyVizVisibility();
  }

  /**
   * Returns true when the viz should currently be on-screen — both
   * user-toggled on AND the terminal is wide enough.
   */
  private shouldShowViz(): boolean {
    const inner = (this.root.width || this.lastWidth) - 2;
    return this.vizEnabled && inner >= MIN_INNER_WIDTH_FOR_VIZ;
  }

  private applyVizVisibility(): void {
    const visible = this.shouldShowViz();
    this.vizCol.visible = visible;
    // Setting width to 0 collapses the column out of the flex layout
    // so the left content reclaims the space cleanly.
    this.vizCol.width = visible ? VIZ_COL_TOTAL : 0;
  }

  private leftInnerWidth(): number {
    const inner = (this.root.width || this.lastWidth) - 2;
    return Math.max(20, inner - (this.shouldShowViz() ? VIZ_COL_TOTAL : 0));
  }

  /**
   * Compose the progress line as a single chunk of LCD-green text.
   * The bar fills the remaining space after the time and volume blocks.
   */
  private renderProgress(p: PlayerState): void {
    const innerWidth = this.leftInnerWidth();

    const glyph = statusGlyph(p.status);
    const pos = formatTime(p.positionSec);
    const dur = formatTime(p.durationSec);
    const timeBlock = `[${glyph}]  ${pos} / ${dur}`;
    const volBlock = `VOL ${volumeBar(p.volume, 10)} ${p.volume
      .toString()
      .padStart(3, " ")}%`;

    const leftPart = `${timeBlock}  `;
    const rightPart = `  ${volBlock}`;
    const barWidth = Math.max(
      6,
      innerWidth - leftPart.length - rightPart.length,
    );
    const bar = progressBar(p.positionSec, p.durationSec || 1, barWidth);

    const chunks: TextChunk[] = [fg(theme.lcd)(`${leftPart}${bar}${rightPart}`)];
    this.progressText.content = new StyledText(chunks);
  }

  private renderBricks(): void {
    const rows = this.spectrum.renderBricks(
      BRICK_BARS,
      BRICK_ROWS,
      ROW_COLORS,
      theme.lcdBg,
    );
    for (let r = 0; r < BRICK_ROWS; r++) {
      const row = rows[r];
      if (!row) continue;
      this.vizRows[r]!.content = new StyledText(row);
    }
  }
}
