import type { CapsuleFile } from './capsule-service';
export type CapsuleTemp = { uri: string; dispose: () => void };
export async function capsuleTemporaryFile(bytes: Uint8Array, file: CapsuleFile): Promise<CapsuleTemp> {
  const uri = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: file.mime_type }));
  let disposed = false;
  return { uri, dispose() { if (!disposed) { disposed = true; URL.revokeObjectURL(uri); } } };
}
