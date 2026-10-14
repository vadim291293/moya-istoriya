import { File } from 'expo-file-system';
import type { MemoryAsset } from './memory-asset';

export async function readPickedMedia(asset: MemoryAsset, maxBytes: number): Promise<ArrayBuffer> {
  const file = new File(asset.uri);
  // Picker metadata can be missing. Reject a known oversized local video before
  // allocating its whole contents; the service also checks actual bytes later.
  if (file.size > maxBytes) throw new Error('File too large');
  return file.arrayBuffer();
}
