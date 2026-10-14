import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';

// Version 1 envelope: AES-256-GCM, native-generated 12-byte IV + 16-byte tag.
// Keys and plaintext are never journalled, logged or persisted in localStorage.
export async function newCapsuleKey() { return (await AESEncryptionKey.generate()).encoded('hex'); }
async function key(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid capsule key');
  return AESEncryptionKey.import(value, 'hex');
}
export async function encryptCapsuleBytes(bytes: ArrayBuffer | Uint8Array, keyHex: string): Promise<Uint8Array> {
  const sealed = await aesEncryptAsync(bytes, await key(keyHex), { nonce: { length: 12 }, tagLength: 16 });
  return sealed.combined('bytes');
}
export async function decryptCapsuleBytes(bytes: ArrayBuffer | Uint8Array, keyHex: string): Promise<Uint8Array> {
  return aesDecryptAsync(AESSealedData.fromCombined(bytes, { ivLength: 12, tagLength: 16 }), await key(keyHex));
}
export async function encryptCapsuleLetter(letter: string, keyHex: string): Promise<string> {
  const sealed = await aesEncryptAsync(new TextEncoder().encode(JSON.stringify({ version: 1, letter })), await key(keyHex),
    { nonce: { length: 12 }, tagLength: 16 });
  return sealed.combined('base64');
}
export async function decryptCapsuleLetter(cipher: string, keyHex: string): Promise<string> {
  const bytes = await aesDecryptAsync(AESSealedData.fromCombined(cipher, { ivLength: 12, tagLength: 16 }), await key(keyHex));
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (value?.version !== 1 || typeof value.letter !== 'string' || value.letter.length > 8000) throw new Error('Invalid capsule letter');
  return value.letter;
}
