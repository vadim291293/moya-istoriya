const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../app.json').expo;
test('voice config enables microphone without ImagePicker globally blocking it and keeps background services off', () => {
  const entry = name => config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === name)?.[1];
  assert.equal(typeof entry('expo-image-picker').microphonePermission, 'string');
  assert.equal(entry('expo-image-picker').cameraPermission, false);
  assert.equal(entry('expo-audio').recordAudioAndroid, true);
  assert.equal(entry('expo-audio').enableBackgroundPlayback, false);
  assert.equal(entry('expo-audio').enableBackgroundRecording, false);
  assert.ok(!config.android.blockedPermissions?.includes('android.permission.RECORD_AUDIO'));
  assert.equal(require('../package.json').dependencies['expo-audio'], '57.0.5');
});
