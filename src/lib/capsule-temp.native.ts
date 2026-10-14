import { File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { CapsuleFile } from './capsule-service';
export type CapsuleTemp = { uri: string; dispose: () => void };
export async function capsuleTemporaryFile(bytes: Uint8Array, source: CapsuleFile): Promise<CapsuleTemp> {
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'audio/webm': 'webm' };
  const ext = extensions[source.mime_type]; if (!ext) throw new Error('Invalid capsule MIME');
  const file = new File(Paths.cache, `moya-capsule-${randomUUID()}.${ext}`);
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; try { if (file.exists) file.delete(); } catch { /* Private OS cache on crash/IO failure. */ } } };
  try { file.create({ overwrite: false }); file.write(bytes); return { uri: file.uri, dispose }; }
  catch (error) { dispose(); throw error; }
}
