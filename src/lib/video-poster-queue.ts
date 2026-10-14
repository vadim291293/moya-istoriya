type PosterPlayer<T> = {
  status: string; duration: number;
  generateThumbnailsAsync: (times: number[], options: { maxWidth: number; maxHeight: number }) => Promise<T[]>;
  onStatus: (listener: (status: string) => void) => { remove: () => void };
  release: () => void;
};

// One non-playing native extractor at a time. Memory-only cache, scoped to the
// visible collection; never store private URLs/images on disk or across accounts.
export function createVideoPosterQueue<T>(createPlayer: (uri: string) => PosterPlayer<T>, timeoutMs = 20000) {
  let disposed = false;
  let chain = Promise.resolve();
  let cancel: (() => void) | null = null;
  const pending = new Map<string, Promise<T | null>>();
  const cache = new Map<string, T>();

  function extract(uri: string): Promise<T | null> {
    if (disposed) return Promise.resolve(null);
    return new Promise((resolve) => {
      let player: PosterPlayer<T> | null = null;
      let subscription: { remove: () => void } | null = null;
      let generating = false;
      let finished = false;
      const finish = (image: T | null) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        subscription?.remove();
        try { player?.release(); } catch { /* Already released. */ }
        cancel = null;
        resolve(disposed ? null : image);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      cancel = () => finish(null);
      const statusChanged = (status: string) => {
        if (finished || !player) return;
        if (status === 'error') { finish(null); return; }
        if (status !== 'readyToPlay' || generating) return;
        generating = true;
        try {
          const time = Number.isFinite(player.duration) && player.duration > 1 ? 0.5 : 0;
          // Native SDK 57 receives List<Duration>/[CMTime]. Always pass an array,
          // even though its public TypeScript signature also accepts a scalar.
          const extractor = player;
          void (async () => {
            for (const at of time > 0 ? [time, 0] : [0]) {
              if (finished || disposed) return;
              try {
                const images = await extractor.generateThumbnailsAsync([at], { maxWidth: 480, maxHeight: 480 });
                if (images[0]) { finish(images[0]); return; }
              } catch { /* Try the initial frame if the seek frame is unavailable. */ }
            }
            finish(null);
          })();
        } catch { finish(null); }
      };
      try {
        player = createPlayer(uri);
        subscription = player.onStatus(statusChanged);
        statusChanged(player.status);
      } catch { finish(null); }
    });
  }

  return {
    get(uri: string) {
      if (disposed) return Promise.resolve(null);
      const existing = cache.get(uri);
      if (existing) return Promise.resolve(existing);
      const request = pending.get(uri);
      if (request) return request;
      const task = chain.then(() => extract(uri)).then((image) => {
        pending.delete(uri);
        if (image && !disposed) {
          cache.set(uri, image);
          if (cache.size > 16) cache.delete(cache.keys().next().value!);
        }
        return image;
      });
      pending.set(uri, task);
      chain = task.then(() => {});
      return task;
    },
    dispose() { disposed = true; cache.clear(); pending.clear(); cancel?.(); },
  };
}
