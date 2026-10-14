import type { MemoryAsset } from './memory-asset';

export async function readPickedMedia(asset: MemoryAsset, maxBytes: number): Promise<ArrayBuffer> {
  if (asset.file) {
    if (asset.file.size > maxBytes) throw new Error('File too large');
    return asset.file.arrayBuffer();
  }

  const response = await fetch(asset.uri);
  if (!response.ok) {
    throw new Error('Не удалось прочитать выбранный файл.');
  }

  const advertisedSize = Number(response.headers.get('content-length'));
  if (advertisedSize > maxBytes) throw new Error('File too large');

  return response.arrayBuffer();
}
