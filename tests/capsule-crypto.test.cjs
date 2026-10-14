const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const { expoCrypto, globals } = require('./capsule-crypto-mock.cjs');
const s = loadTypescript('src/lib/capsule-crypto.ts', { 'expo-crypto': expoCrypto }, globals);
const key = 'a'.repeat(64);
test('capsule AES-256-GCM letter roundtrip retains Unicode and never stores readable text', async () => {
  const letter = 'Ася, привет из прошлого ❤️\nМы тебя любим!';
  const encrypted = await s.encryptCapsuleLetter(letter, key);
  assert.ok(!Buffer.from(encrypted, 'base64').includes(Buffer.from(letter)));
  assert.equal(await s.decryptCapsuleLetter(encrypted, key), letter);
});
test('binary media envelope adds exactly a 12-byte IV and 16-byte GCM tag', async () => {
  const bytes = new Uint8Array([0, 128, 255, 40, 39, 0]);
  const encrypted = await s.encryptCapsuleBytes(bytes, key);
  assert.equal(encrypted.byteLength, bytes.byteLength + 28);
  assert.deepEqual(await s.decryptCapsuleBytes(encrypted, key), bytes);
});
test('each encryption generates a new IV; generated vault keys have 256 bits', async () => {
  assert.notEqual(await s.encryptCapsuleLetter('Привет', key), await s.encryptCapsuleLetter('Привет', key));
  const one = await s.newCapsuleKey(), two = await s.newCapsuleKey();
  assert.match(one, /^[0-9a-f]{64}$/); assert.notEqual(one, two);
});
test('tampered ciphertext and the wrong key fail authentication', async () => {
  const bytes = await s.encryptCapsuleBytes(new Uint8Array([10, 20, 30]), key);
  const broken = bytes.slice(); broken[12] ^= 1;
  await assert.rejects(s.decryptCapsuleBytes(broken, key));
  await assert.rejects(s.decryptCapsuleBytes(bytes, 'b'.repeat(64)));
});
test('invalid keys and unsupported letter envelopes cannot become plaintext', async () => {
  await assert.rejects(s.encryptCapsuleLetter('Hello', 'not-a-key'));
  const sealed = await expoCrypto.aesEncryptAsync(new TextEncoder().encode('{"version":2,"letter":"bad"}'), Buffer.from(key, 'hex'), { nonce: { length: 12 }, tagLength: 16 });
  await assert.rejects(s.decryptCapsuleLetter(sealed.combined('base64'), key), /Invalid capsule letter/);
});
