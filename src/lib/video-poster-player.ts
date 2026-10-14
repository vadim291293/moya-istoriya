import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { createVideoPlayer } from 'expo-video';

// Android's metadata retriever and the actual playback decoder have different
// network paths. If streaming-frame extraction fails, retry from a bounded,
// private temporary local copy. Never export it to the phone's media library.
export function nativePosterPlayer(uri: string) {
  const player = createVideoPlayer({ uri, useCaching: false });
  let released = false;
  let remoteReleased = false;
  let lastDuration = 0;
  let temporaryUri: string | null = null;
  let localPlayer: ReturnType<typeof createVideoPlayer> | null = null;
  let download: ReturnType<typeof FileSystem.createDownloadResumable> | null = null;
  let localReady: Promise<void> | null = null;
  const removeTemporary = () => {
    if (temporaryUri) void FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => {});
  };
  try { player.staysActiveInBackground = false; player.showNowPlayingNotification = false; }
  catch (error) { player.release(); throw error; }
  async function prepareLocal() {
    if (released || !FileSystem.cacheDirectory) throw new Error('Poster cancelled');
    const source = new URL(uri);
    if (source.protocol !== 'https:') throw new Error('Invalid poster source');
    const extension = source.pathname.match(/\.(mp4|mov|webm)$/i)?.[1]?.toLowerCase() ?? 'mp4';
    temporaryUri = `${FileSystem.cacheDirectory}moya-poster-${Crypto.randomUUID()}.${extension}`;
    const maxBytes = 50 * 1024 * 1024;
    let oversized = false;
    remoteReleased = true; player.release();
    download = FileSystem.createDownloadResumable(uri, temporaryUri, {}, progress => {
      if (progress.totalBytesWritten > maxBytes || progress.totalBytesExpectedToWrite > maxBytes) oversized = true;
      if (released || oversized) {
        void download?.cancelAsync().catch(() => {});
      }
    });
    try {
      const result = await download.downloadAsync();
      if (released || oversized || !result || result.status !== 200) throw new Error('Poster download unavailable');
      const info = await FileSystem.getInfoAsync(temporaryUri);
      if (released || !info.exists || info.size < 1 || info.size > maxBytes) throw new Error('Invalid poster file');
      localPlayer = createVideoPlayer(null);
      localPlayer.staysActiveInBackground = false; localPlayer.showNowPlayingNotification = false;
      await localPlayer.replaceAsync({ uri: temporaryUri, useCaching: false });
      if (released) throw new Error('Poster cancelled');
    } catch (error) { removeTemporary(); throw error; }
  }
  return {
    get status() { return remoteReleased ? localPlayer?.status ?? 'loading' : player.status; },
    get duration() { if (!remoteReleased) lastDuration = player.duration; return lastDuration; },
    async generateThumbnailsAsync(times: number[], options: { maxWidth: number; maxHeight: number }) {
      if (released) throw new Error('Poster cancelled');
      try {
        if (!remoteReleased) {
          const frames = await player.generateThumbnailsAsync(times, options);
          if (frames.length) return frames;
        }
      } catch { /* Recover streaming extraction via a local-only source. */ }
      if (released) throw new Error('Poster cancelled');
      localReady ??= prepareLocal();
      await localReady;
      if (released || !localPlayer) throw new Error('Poster cancelled');
      return localPlayer.generateThumbnailsAsync(times, options);
    },
    onStatus: (listener: (status: string) => void) => player.addListener('statusChange', event => { if (!remoteReleased) listener(event.status); }),
    release() {
      if (released) return;
      released = true;
      void download?.cancelAsync().catch(() => {});
      try { if (!remoteReleased) { remoteReleased = true; player.release(); } }
      finally { try { localPlayer?.release(); } finally { removeTemporary(); } }
    },
  };
}
