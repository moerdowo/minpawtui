import { EventEmitter } from "node:events";
import type {
  AppState,
  PanelId,
  PlayerState,
  RepeatMode,
  Track,
} from "../types.ts";

export class Store extends EventEmitter {
  private state: AppState;

  constructor(rootDir: string) {
    super();
    const player: PlayerState = {
      status: "stopped",
      currentTrack: null,
      positionSec: 0,
      durationSec: 0,
      volume: 80,
      muted: false,
      repeat: "off",
      shuffle: false,
    };
    this.state = {
      library: [],
      playlist: [],
      playlistIndex: -1,
      libraryCursor: 0,
      playlistCursor: 0,
      focusedPanel: "library",
      player,
      rootDir,
      showHelp: false,
      statusMessage: "",
      statusMessageTime: 0,
    };
    this.setMaxListeners(100);
  }

  get(): AppState {
    return this.state;
  }

  private emitChange(): void {
    this.emit("change", this.state);
  }

  /* ------------------------------------------------------ */
  /* Library                                                */
  /* ------------------------------------------------------ */

  setLibrary(tracks: Track[]): void {
    this.state.library = tracks;
    if (this.state.libraryCursor >= tracks.length) {
      this.state.libraryCursor = Math.max(0, tracks.length - 1);
    }
    this.emitChange();
  }

  moveLibraryCursor(delta: number): void {
    const max = this.state.library.length - 1;
    if (max < 0) return;
    this.state.libraryCursor = Math.max(
      0,
      Math.min(max, this.state.libraryCursor + delta),
    );
    this.emitChange();
  }

  setLibraryCursor(index: number): void {
    const max = this.state.library.length - 1;
    if (max < 0) return;
    this.state.libraryCursor = Math.max(0, Math.min(max, index));
    this.emitChange();
  }

  /* ------------------------------------------------------ */
  /* Playlist                                               */
  /* ------------------------------------------------------ */

  addToPlaylist(track: Track): void {
    this.state.playlist.push(track);
    this.emitChange();
  }

  addAllToPlaylist(tracks: Track[]): void {
    this.state.playlist.push(...tracks);
    this.emitChange();
  }

  removeFromPlaylist(index: number): void {
    if (index < 0 || index >= this.state.playlist.length) return;
    this.state.playlist.splice(index, 1);
    if (index < this.state.playlistIndex) {
      this.state.playlistIndex -= 1;
    } else if (index === this.state.playlistIndex) {
      // playing track removed
      if (this.state.playlistIndex >= this.state.playlist.length) {
        this.state.playlistIndex = this.state.playlist.length - 1;
      }
    }
    if (this.state.playlistCursor >= this.state.playlist.length) {
      this.state.playlistCursor = Math.max(0, this.state.playlist.length - 1);
    }
    this.emitChange();
  }

  clearPlaylist(): void {
    this.state.playlist = [];
    this.state.playlistIndex = -1;
    this.state.playlistCursor = 0;
    this.emitChange();
  }

  movePlaylistCursor(delta: number): void {
    const max = this.state.playlist.length - 1;
    if (max < 0) return;
    this.state.playlistCursor = Math.max(
      0,
      Math.min(max, this.state.playlistCursor + delta),
    );
    this.emitChange();
  }

  setPlaylistCursor(index: number): void {
    const max = this.state.playlist.length - 1;
    if (max < 0) return;
    this.state.playlistCursor = Math.max(0, Math.min(max, index));
    this.emitChange();
  }

  setPlaylistIndex(index: number): void {
    this.state.playlistIndex = index;
    this.emitChange();
  }

  /* ------------------------------------------------------ */
  /* Focus                                                  */
  /* ------------------------------------------------------ */

  setFocus(panel: PanelId): void {
    this.state.focusedPanel = panel;
    this.emitChange();
  }

  toggleFocus(): void {
    this.state.focusedPanel =
      this.state.focusedPanel === "library" ? "playlist" : "library";
    this.emitChange();
  }

  /* ------------------------------------------------------ */
  /* Player                                                 */
  /* ------------------------------------------------------ */

  setPlayerStatus(status: PlayerState["status"]): void {
    this.state.player.status = status;
    this.emitChange();
  }

  setCurrentTrack(track: Track | null): void {
    this.state.player.currentTrack = track;
    if (track) this.state.player.durationSec = track.durationSec;
    this.emitChange();
  }

  setPosition(positionSec: number): void {
    this.state.player.positionSec = positionSec;
    this.emitChange();
  }

  setDuration(durationSec: number): void {
    this.state.player.durationSec = durationSec;
    this.emitChange();
  }

  setVolume(volume: number): void {
    this.state.player.volume = Math.max(0, Math.min(100, Math.round(volume)));
    this.emitChange();
  }

  cycleRepeat(): RepeatMode {
    const next: Record<RepeatMode, RepeatMode> = {
      off: "all",
      all: "one",
      one: "off",
    };
    this.state.player.repeat = next[this.state.player.repeat];
    this.emitChange();
    return this.state.player.repeat;
  }

  toggleShuffle(): boolean {
    this.state.player.shuffle = !this.state.player.shuffle;
    this.emitChange();
    return this.state.player.shuffle;
  }

  /* ------------------------------------------------------ */
  /* UI                                                     */
  /* ------------------------------------------------------ */

  toggleHelp(): void {
    this.state.showHelp = !this.state.showHelp;
    this.emitChange();
  }

  setStatusMessage(msg: string): void {
    this.state.statusMessage = msg;
    this.state.statusMessageTime = Date.now();
    this.emitChange();
  }

  clearStatusMessageIfStale(maxAgeMs = 3500): void {
    if (
      this.state.statusMessage &&
      Date.now() - this.state.statusMessageTime > maxAgeMs
    ) {
      this.state.statusMessage = "";
      this.emitChange();
    }
  }
}
