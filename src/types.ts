export interface Track {
  id: string;
  path: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  bitrate?: number;
  sampleRate?: number;
}

export type PanelId = "library" | "playlist";

export type PlayerStatus = "stopped" | "playing" | "paused";

export type RepeatMode = "off" | "one" | "all";

export interface PlayerState {
  status: PlayerStatus;
  currentTrack: Track | null;
  positionSec: number;
  durationSec: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
}

export interface AppState {
  library: Track[];
  playlist: Track[];
  playlistIndex: number;
  libraryCursor: number;
  playlistCursor: number;
  focusedPanel: PanelId;
  player: PlayerState;
  rootDir: string;
  showHelp: boolean;
  statusMessage: string;
  statusMessageTime: number;
}
