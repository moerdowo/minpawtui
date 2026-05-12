import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";
import { theme } from "../theme.ts";
import { Store } from "../state/store.ts";
import { createPlayer, type Player } from "../audio/player.ts";
import { scanFolder } from "../audio/scanner.ts";
import type { Track } from "../types.ts";
import { Header } from "./header.ts";
import { Transport } from "./transport.ts";
import { ListPanel } from "./list-panel.ts";
import { Footer } from "./footer.ts";
import { Help } from "./help.ts";

export interface AppOptions {
  rootDir: string;
}

export class MinpawApp {
  private renderer!: CliRenderer;
  private store: Store;
  private player!: Player;

  private header!: Header;
  private transport!: Transport;
  private libraryPanel!: ListPanel;
  private playlistPanel!: ListPanel;
  private footer!: Footer;
  private help!: Help;

  private scanBox!: BoxRenderable;
  private scanText!: TextRenderable;

  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private vizTimer: ReturnType<typeof setInterval> | null = null;
  private lastVizTick = Date.now();
  private rng = Math.random;

  constructor(opts: AppOptions) {
    this.store = new Store(opts.rootDir);
  }

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      exitOnCtrlC: true,
      targetFps: 30,
      backgroundColor: theme.bg,
    });

    this.player = createPlayer();
    this.wirePlayerEvents();

    this.buildUI();
    this.bindKeys();

    this.store.on("change", () => {
      this.updateUI();
      this.renderer.requestRender();
    });

    this.renderer.start();
    this.updateUI();

    // Periodic status-message cleanup
    this.statusTimer = setInterval(() => {
      this.store.clearStatusMessageIfStale();
    }, 1000);

    // Inline spectrum tick (~20 fps). Independent of store changes so
    // the bars keep moving smoothly between key events.
    this.lastVizTick = Date.now();
    this.vizTimer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.1, (now - this.lastVizTick) / 1000);
      this.lastVizTick = now;
      const player = this.store.get().player;
      // Always advance the simulation so peaks decay even when disabled.
      this.transport.tickViz(player, dt);
      if (this.transport.isVizEnabled()) this.renderer.requestRender();
    }, 50);

    await this.scanLibrary();
  }

  private wirePlayerEvents(): void {
    this.player.on("positionChange", (pos) => {
      this.store.setPosition(pos);
    });
    this.player.on("ended", () => {
      this.handleTrackEnded();
    });
    this.player.on("started", (track) => {
      this.store.setCurrentTrack(track);
      this.store.setPlayerStatus("playing");
    });
    this.player.on("paused", () => this.store.setPlayerStatus("paused"));
    this.player.on("resumed", () => this.store.setPlayerStatus("playing"));
    this.player.on("stopped", () => this.store.setPlayerStatus("stopped"));
    this.player.on("error", (err) => {
      this.store.setStatusMessage(`Player error: ${err.message}`);
    });
    this.player.on("volumeChange", (v) => this.store.setVolume(v));
  }

  private buildUI(): void {
    const root = new BoxRenderable(this.renderer, {
      id: "app-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: theme.bg,
    });
    this.renderer.root.add(root);

    this.header = new Header(this.renderer);
    root.add(this.header.root);

    this.transport = new Transport(this.renderer);
    root.add(this.transport.root);

    const middle = new BoxRenderable(this.renderer, {
      id: "middle",
      width: "100%",
      flexDirection: "row",
      flexGrow: 1,
    });
    root.add(middle);

    this.libraryPanel = new ListPanel(this.renderer, {
      id: "library",
      title: "LIBRARY",
      emptyMessage: "No audio files found. Pass a folder as argument to scan.",
      showIndex: false,
    });
    this.libraryPanel.root.width = "55%";
    middle.add(this.libraryPanel.root);

    this.playlistPanel = new ListPanel(this.renderer, {
      id: "playlist",
      title: "PLAYLIST",
      emptyMessage: "Playlist is empty. Press [A] in library to add a track.",
      showIndex: true,
    });
    this.playlistPanel.root.width = "45%";
    middle.add(this.playlistPanel.root);

    this.footer = new Footer(this.renderer);
    root.add(this.footer.root);

    this.help = new Help(this.renderer);
    this.renderer.root.add(this.help.root);

    // Scan overlay
    this.scanBox = new BoxRenderable(this.renderer, {
      id: "scan-overlay",
      position: "absolute",
      top: 6,
      left: 4,
      right: 4,
      height: 5,
      border: true,
      borderStyle: "rounded",
      borderColor: theme.lcd,
      backgroundColor: theme.lcdBg,
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      flexDirection: "column",
      zIndex: 90,
      visible: false,
    });
    this.scanText = new TextRenderable(this.renderer, {
      id: "scan-text",
      content: "Scanning…",
      fg: theme.lcd,
    });
    this.scanBox.add(this.scanText);
    this.renderer.root.add(this.scanBox);
  }

  private updateUI(): void {
    const s = this.store.get();
    this.header.update(s);
    this.transport.update(s);

    this.libraryPanel.setTitle(`LIBRARY  (${s.library.length})`);
    this.libraryPanel.render({
      tracks: s.library,
      cursor: s.libraryCursor,
      focused: s.focusedPanel === "library" && !s.showHelp,
    });

    this.playlistPanel.setTitle(`PLAYLIST  (${s.playlist.length})`);
    this.playlistPanel.render({
      tracks: s.playlist,
      cursor: s.playlistCursor,
      nowPlayingIndex: s.playlistIndex,
      focused: s.focusedPanel === "playlist" && !s.showHelp,
    });

    this.help.setVisible(s.showHelp);
    this.footer.update();
  }

  /* -------------------------------------------------------- */
  /* Library scan                                             */
  /* -------------------------------------------------------- */

  private async scanLibrary(): Promise<void> {
    const s = this.store.get();
    this.scanBox.visible = true;
    this.scanText.content = `Scanning ${s.rootDir} …`;
    this.renderer.requestRender();

    try {
      const tracks = await scanFolder(s.rootDir, {
        recursive: true,
        onProgress: (n, p) => {
          this.scanText.content = `Scanning… (${n})  ${p.slice(-60)}`;
          this.renderer.requestRender();
        },
      });
      this.store.setLibrary(tracks);
      const backend = this.player.backend;
      const backendNote =
        backend === "mpv"
          ? "mpv backend (full control)"
          : backend === "ffplay"
            ? "ffplay backend — seek/pause restart the stream"
            : backend === "afplay"
              ? "afplay backend — no seek/pause control"
              : "no backend";
      this.store.setStatusMessage(
        tracks.length > 0
          ? `Indexed ${tracks.length} tracks · ${backendNote}`
          : `No audio files found in ${s.rootDir}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.setStatusMessage(`Scan failed: ${msg}`);
    } finally {
      this.scanBox.visible = false;
      this.renderer.requestRender();
    }
  }

  /* -------------------------------------------------------- */
  /* Playback control                                         */
  /* -------------------------------------------------------- */

  private async playTrackAt(playlistIndex: number): Promise<void> {
    const s = this.store.get();
    const track = s.playlist[playlistIndex];
    if (!track) return;
    this.store.setPlaylistIndex(playlistIndex);
    try {
      await this.player.load(track);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.store.setStatusMessage(`Failed to play: ${msg}`);
    }
  }

  private addToPlaylistAndPlay(track: Track): void {
    const s = this.store.get();
    this.store.addToPlaylist(track);
    const newIndex = s.playlist.length - 1;
    this.store.setPlaylistCursor(newIndex);
    void this.playTrackAt(newIndex);
  }

  private handleTrackEnded(): void {
    const s = this.store.get();
    if (s.player.repeat === "one") {
      void this.playTrackAt(s.playlistIndex);
      return;
    }
    this.advance(1, /*manual=*/ false);
  }

  private advance(dir: 1 | -1, manual: boolean): void {
    const s = this.store.get();
    const len = s.playlist.length;
    if (len === 0) return;

    if (s.player.shuffle && dir === 1 && len > 1) {
      let next = Math.floor(this.rng() * len);
      if (next === s.playlistIndex) next = (next + 1) % len;
      void this.playTrackAt(next);
      return;
    }

    let next = s.playlistIndex + dir;
    if (next >= len) {
      if (s.player.repeat === "all" || manual) {
        next = 0;
      } else {
        void this.player.stop();
        this.store.setPlaylistIndex(-1);
        return;
      }
    }
    if (next < 0) {
      next = s.player.repeat === "all" || manual ? len - 1 : 0;
    }
    void this.playTrackAt(next);
  }

  /* -------------------------------------------------------- */
  /* Key handling                                             */
  /* -------------------------------------------------------- */

  private bindKeys(): void {
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      void this.handleKey(key);
    });
  }

  private async handleKey(key: KeyEvent): Promise<void> {
    const s = this.store.get();

    // Help overlay: only ?, F1, escape, q
    if (s.showHelp) {
      if (key.name === "escape" || key.name === "?" || key.name === "f1" || key.sequence === "?") {
        this.store.toggleHelp();
        return;
      }
      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        await this.quit();
        return;
      }
      return;
    }

    if (key.ctrl && key.name === "c") {
      await this.quit();
      return;
    }
    if (key.name === "q") {
      await this.quit();
      return;
    }
    if (key.name === "?" || key.sequence === "?" || key.name === "f1") {
      this.store.toggleHelp();
      return;
    }

    // Focus switching
    if (key.name === "tab") {
      this.store.toggleFocus();
      return;
    }
    if (key.name === "1") {
      this.store.setFocus("library");
      return;
    }
    if (key.name === "2") {
      this.store.setFocus("playlist");
      return;
    }

    // Playback
    if (key.name === "space") {
      if (this.player.isPlaying() || this.player.isPaused()) {
        await this.player.togglePause();
      } else if (s.playlist.length > 0) {
        await this.playTrackAt(Math.max(0, s.playlistIndex));
      } else if (s.library.length > 0) {
        const track = s.library[s.libraryCursor];
        if (track) this.addToPlaylistAndPlay(track);
      }
      return;
    }
    if (key.name === "s" && !key.shift && !key.ctrl) {
      await this.player.stop();
      this.store.setPlaylistIndex(-1);
      return;
    }
    if (key.name === "n" || (key.name === "right" && !this.isListNavRight(s))) {
      this.advance(1, true);
      return;
    }
    if (key.name === "p" || (key.name === "left" && !this.isListNavLeft(s))) {
      this.advance(-1, true);
      return;
    }

    // Seek
    if (key.name === "[") {
      await this.player.seek(-5);
      return;
    }
    if (key.name === "]") {
      await this.player.seek(5);
      return;
    }
    if (key.sequence === "{") {
      await this.player.seek(-30);
      return;
    }
    if (key.sequence === "}") {
      await this.player.seek(30);
      return;
    }

    // Volume
    if (key.name === "+" || key.sequence === "+" || key.name === "=") {
      const v = Math.min(100, s.player.volume + 5);
      await this.player.setVolume(v);
      return;
    }
    if (key.name === "-" || key.sequence === "-") {
      const v = Math.max(0, s.player.volume - 5);
      await this.player.setVolume(v);
      return;
    }
    if (key.name === "m") {
      // mute toggle: store volume locally if unmute
      if (!s.player.muted) {
        (this as any)._prevVolume = s.player.volume;
        await this.player.setVolume(0);
        s.player.muted = true;
      } else {
        const prev = (this as any)._prevVolume ?? 70;
        await this.player.setVolume(prev);
        s.player.muted = false;
      }
      return;
    }

    // Visualizer toggle (inline mini-spectrum, right of the volume)
    if (key.name === "v") {
      const next = !this.transport.isVizEnabled();
      this.transport.setVizEnabled(next);
      this.store.setStatusMessage(`Visualizer: ${next ? "on" : "off"}`);
      return;
    }

    // Repeat/shuffle
    if (key.name === "r") {
      const mode = this.store.cycleRepeat();
      this.store.setStatusMessage(`Repeat: ${mode}`);
      return;
    }
    if (key.name === "z") {
      const on = this.store.toggleShuffle();
      this.store.setStatusMessage(`Shuffle: ${on ? "on" : "off"}`);
      return;
    }

    // List nav
    const focused = s.focusedPanel;
    const cursor = focused === "library" ? s.libraryCursor : s.playlistCursor;
    const tracks = focused === "library" ? s.library : s.playlist;
    const setCursor = (idx: number) => {
      if (focused === "library") this.store.setLibraryCursor(idx);
      else this.store.setPlaylistCursor(idx);
    };
    const moveCursor = (d: number) => {
      if (focused === "library") this.store.moveLibraryCursor(d);
      else this.store.movePlaylistCursor(d);
    };
    const pageSize =
      focused === "library"
        ? this.libraryPanel.pageSize()
        : this.playlistPanel.pageSize();

    if (key.name === "up" || key.name === "k") {
      moveCursor(-1);
      return;
    }
    if (key.name === "down" || key.name === "j") {
      moveCursor(1);
      return;
    }
    if (key.name === "pageup") {
      moveCursor(-pageSize);
      return;
    }
    if (key.name === "pagedown") {
      moveCursor(pageSize);
      return;
    }
    if (key.name === "home" || (key.name === "g" && !key.shift)) {
      setCursor(0);
      return;
    }
    if (key.name === "end" || (key.name === "g" && key.shift)) {
      setCursor(Math.max(0, tracks.length - 1));
      return;
    }

    // Enter on library: add+play. On playlist: play at cursor.
    if (key.name === "return" || key.name === "enter") {
      if (focused === "library") {
        const track = tracks[cursor];
        if (track) this.addToPlaylistAndPlay(track);
      } else {
        await this.playTrackAt(cursor);
      }
      return;
    }

    // Library actions
    if (focused === "library") {
      if (key.name === "a" && !key.shift) {
        const track = tracks[cursor];
        if (track) {
          this.store.addToPlaylist(track);
          this.store.setStatusMessage(`Added: ${track.title}`);
        }
        return;
      }
      if (key.name === "a" && key.shift) {
        this.store.addAllToPlaylist(s.library);
        this.store.setStatusMessage(`Added ${s.library.length} tracks`);
        return;
      }
    }

    // Playlist actions
    if (focused === "playlist") {
      if (key.name === "d" || key.name === "delete" || key.name === "backspace") {
        this.store.removeFromPlaylist(cursor);
        return;
      }
      if (key.name === "c" && key.shift) {
        // Shift+C as a destructive guard? Keep it simple: c clears.
        this.store.clearPlaylist();
        await this.player.stop();
        return;
      }
      if (key.name === "c") {
        this.store.clearPlaylist();
        await this.player.stop();
        return;
      }
    }
  }

  private isListNavRight(_s: ReturnType<typeof this.store.get>): boolean {
    return false; // arrows are reserved for prev/next, not horizontal scroll
  }
  private isListNavLeft(_s: ReturnType<typeof this.store.get>): boolean {
    return false;
  }

  /* -------------------------------------------------------- */
  /* Lifecycle                                                */
  /* -------------------------------------------------------- */

  async quit(): Promise<void> {
    try {
      if (this.statusTimer) clearInterval(this.statusTimer);
      if (this.vizTimer) clearInterval(this.vizTimer);
      await this.player.destroy();
    } catch {
      /* ignore */
    }
    try {
      this.renderer.stop();
    } catch {
      /* ignore */
    }
    process.exit(0);
  }
}
