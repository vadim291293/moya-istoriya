import type { ImagePickerAsset } from 'expo-image-picker';

export type VoiceAsset = {
  uri: string;
  type: 'audio';
  width: 0;
  height: 0;
  fileName: string;
  mimeType: 'audio/mp4' | 'audio/webm';
  fileSize?: number;
  duration?: number;
  assetId?: null;
  file?: File;
};

export type MemoryAsset = ImagePickerAsset | VoiceAsset;
export const MAX_VOICE_SECONDS = 180;
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
export function isVoiceAsset(asset: MemoryAsset): asset is VoiceAsset { return asset.type === 'audio'; }
