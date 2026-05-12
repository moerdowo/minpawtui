import { readdir, stat } from "node:fs/promises";
import { join, basename, extname, resolve } from "node:path";
import { parseFile } from "music-metadata";
import type { Track } from "../types.ts";

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".m4b",
  ".aac",
  ".flac",
  ".ogg",
  ".oga",
  ".opus",
  ".wav",
  ".wma",
  ".aiff",
  ".aif",
]);

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".Trash",
  "$RECYCLE.BIN",
]);

export interface ScanOptions {
  recursive?: boolean;
  maxDepth?: number;
  onProgress?: (scanned: number, currentPath: string) => void;
}

export async function scanFolder(
  rootDir: string,
  options: ScanOptions = {},
): Promise<Track[]> {
  const recursive = options.recursive ?? true;
  const maxDepth = options.maxDepth ?? 10;
  const absoluteRoot = resolve(rootDir);

  const audioFiles: string[] = [];
  await collectAudioFiles(absoluteRoot, audioFiles, recursive, maxDepth, 0);

  const tracks: Track[] = [];
  let scanned = 0;
  for (const file of audioFiles) {
    const track = await readTrackMetadata(file);
    if (track) tracks.push(track);
    scanned += 1;
    options.onProgress?.(scanned, file);
  }

  tracks.sort((a, b) => {
    const aKey = `${a.artist}|${a.album}|${a.title}`.toLowerCase();
    const bKey = `${b.artist}|${b.album}|${b.title}`.toLowerCase();
    return aKey.localeCompare(bKey);
  });

  return tracks;
}

async function collectAudioFiles(
  dir: string,
  out: string[],
  recursive: boolean,
  maxDepth: number,
  depth: number,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (recursive && depth < maxDepth) {
        await collectAudioFiles(fullPath, out, recursive, maxDepth, depth + 1);
      }
      continue;
    }

    if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (AUDIO_EXTENSIONS.has(ext)) out.push(fullPath);
    }
  }
}

async function readTrackMetadata(filePath: string): Promise<Track | null> {
  let durationSec = 0;
  let title = basename(filePath, extname(filePath));
  let artist = "Unknown Artist";
  let album = "Unknown Album";
  let bitrate: number | undefined;
  let sampleRate: number | undefined;

  try {
    const meta = await parseFile(filePath, {
      duration: true,
      skipCovers: true,
    });
    durationSec = Math.max(0, Math.round(meta.format.duration ?? 0));
    bitrate = meta.format.bitrate;
    sampleRate = meta.format.sampleRate;
    if (meta.common.title) title = meta.common.title;
    if (meta.common.artist) artist = meta.common.artist;
    if (meta.common.album) album = meta.common.album;
  } catch {
    try {
      const s = await stat(filePath);
      if (!s.isFile()) return null;
    } catch {
      return null;
    }
  }

  return {
    id: filePath,
    path: filePath,
    filename: basename(filePath),
    title,
    artist,
    album,
    durationSec,
    bitrate,
    sampleRate,
  };
}
