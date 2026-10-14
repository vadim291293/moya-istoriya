const crypto = require('node:crypto');
// Actual AES-256-GCM in Node, adapted to Expo's envelope API. Native bridge is
// deliberately not simulated: it still needs the physical-device smoke check.
const envelope = bytes => ({ bytes: Buffer.from(bytes), combined: encoding => encoding === 'base64'
  ? Buffer.from(bytes).toString('base64') : new Uint8Array(bytes) });
const expoCrypto = {
  randomUUID: () => crypto.randomUUID(),
  AESEncryptionKey: {
    generate: async () => ({ encoded: async () => crypto.randomBytes(32).toString('hex') }),
    import: async value => Buffer.from(value, 'hex'),
  },
  AESSealedData: { fromCombined: value => envelope(typeof value === 'string' ? Buffer.from(value, 'base64') : value) },
  aesEncryptAsync: async (bytes, key, options) => {
    if (options.nonce.length !== 12 || options.tagLength !== 16) throw new Error('Unexpected envelope');
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    return envelope(Buffer.concat([iv, cipher.update(Buffer.from(bytes)), cipher.final(), cipher.getAuthTag()]));
  },
  aesDecryptAsync: async (sealed, key) => {
    const bytes = sealed.bytes;
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(-16));
    return new Uint8Array(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]));
  },
};
const globals = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer };
module.exports = { expoCrypto, globals };
