// Static React Native Web rendering with fictional data. No auth bypass in the
// application, no network, no writes. This is NOT native/screenshot verification.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const RN = require('react-native-web');
const { loadTypescript } = require('../tests/load-typescript.cjs');
const assert = require('node:assert/strict');
const noWrite = () => { throw new Error('A static preview must not write data'); };
const family = { status: 'ready', family: { id: 'demo-family', name: 'Семья Ивановых' },
  children: [{ id: 'demo-child', name: 'Александра', birth_date: '2024-01-01', photo: null }] };
let auth = { session: { user: { id: 'demo-user', email: 'demo@example.invalid' } }, family };
let routeParams = { id: 'demo-child' };
const Svg = ({ accessible, children, ...props }) => React.createElement('svg', props, children);
const primitives = Object.fromEntries(['Circle', 'Path', 'Rect'].map((name) => [name, (props) => React.createElement(name.toLowerCase(), props)]));
// RN Web Modal is a portal and renders nothing in SSR. Only in this static
// diagnostic, mount its visible children inline; this does not test a modal.
const StaticModal = ({ visible, children }) => visible ? React.createElement(RN.View, null, children) : null;
const mocks = {
  react: React, 'react-native': { ...RN, Modal: StaticModal }, 'react-native-svg': { __esModule: true, default: Svg, ...primitives },
  'react-native-safe-area-context': { SafeAreaView: RN.View },
  'expo-router': { useRouter: () => ({ push: noWrite, replace: noWrite, back: noWrite, canGoBack: () => true }),
    useNavigation: () => ({ dispatch: noWrite }), useLocalSearchParams: () => routeParams, useIsFocused: () => true, useFocusEffect() {} },
  'expo-router/react-navigation': { usePreventRemove() {} },
  'expo-crypto': { randomUUID: noWrite, getRandomBytes: noWrite },
  './supabase': { supabase: { from: noWrite, rpc: noWrite, auth: {} } },
  'expo-image-picker': {}, '@react-native-community/datetimepicker': { __esModule: true, default: () => null },
  'expo': { useEvent: (_player, event, initial) => event === 'statusChange' ? { status: 'readyToPlay' } : initial },
  'expo-image': { Image: ({ source, contentFit, cachePolicy, ...props }) => React.createElement(RN.View, props) },
  'expo-status-bar': { StatusBar: () => null },
  'expo-video': { VideoView: ({ accessibilityLabel, style }) => React.createElement(RN.View, { accessibilityLabel, style }),
    createVideoPlayer: noWrite,
    useVideoPlayer: () => ({ status: 'readyToPlay', playing: false, currentTime: 0, duration: 14, bufferedPosition: 14 }) },
  './photo-viewer': { PhotoViewer: () => null },
  './video-viewer': { VideoViewer: () => null },
  '../../components/photo-viewer': { PhotoViewer: () => null },
  '../../components/video-viewer': { VideoViewer: () => null },
  '../../components/audio-viewer': { AudioViewer: () => null },
  'expo-file-system': { File: class { constructor(uri) { this.uri = uri; this.size = 128; } } },
  'expo-file-system/legacy': {},
  'expo-audio': {
    RecordingPresets: { HIGH_QUALITY: {} }, AudioModule: { requestRecordingPermissionsAsync: noWrite },
    setAudioModeAsync: noWrite,
    useAudioRecorder: () => ({ uri: null, prepareToRecordAsync: noWrite, record: noWrite, stop: noWrite }),
    useAudioRecorderState: () => ({ durationMillis: 0, isRecording: false }),
    useAudioPlayer: () => ({ currentTime: 0, duration: 10, playing: false, play: noWrite, pause: noWrite, seekTo: noWrite }),
    useAudioPlayerStatus: () => ({ currentTime: 0, duration: 10, playing: false, isLoaded: true, error: null }),
  },
};
for (const prefix of ['../lib/', '../../lib/']) {
  mocks[prefix + 'auth-context'] = { useAuth: () => ({ ...auth, signOut: noWrite, refreshFamily: noWrite, selectFamily: noWrite }) };
  mocks[prefix + 'supabase'] = { supabase: { from: noWrite, rpc: noWrite, auth: {} } };
  mocks[prefix + 'memory-service'] = { getFamilyMemories: noWrite, createFamilyMemory: noWrite, getPendingFamilyMemory: () => null,
    MAX_MEDIA_FILE_SIZE: 52428800, MEMORY_PAGE_SIZE: 10, MemoryWriteError: class extends Error {} };
  mocks[prefix + 'child-service'] = { createFamilyChild: noWrite, getPendingFamilyChild: () => null, MAX_CHILD_NAME_LENGTH: 80, ChildWriteError: class extends Error {} };
  mocks[prefix + 'media-picker'] = { hasPendingMediaPicker: () => false, chooseFamilyMedia: noWrite, recoverFamilyMedia: noWrite,
    finishMediaPicker: noWrite, clearMediaPickerBeforeSave: noWrite, MediaPickerError: class extends Error {} };
}
const pages = [
  ['welcome', 'src/app/index.tsx', 'default', {}, 'Начать свою историю'],
  ['auth', 'src/components/auth-screen.tsx', 'AuthScreen', { title: 'С возвращением', subtitle: 'Семейная книга', onBack: noWrite, busy: false }, 'С возвращением'],
  ['home', 'src/app/home.tsx', 'default', {}, 'Добавить'],
  ['child-book', 'src/app/child/[id].tsx', 'default', {}, 'Александра'],
  ['memory-new', 'src/app/memory/new.tsx', 'default', {}, 'Сохранить воспоминание'],
  ['child-new', 'src/components/new-child-form.tsx', 'NewChildForm', { userId: 'demo-user', familyId: 'demo-family', familyName: 'Семья Ивановых' }, 'Создать книгу ребёнка'],
  ['setup', 'src/app/setup.tsx', 'default', {}, 'Создать семейную историю'],
  ['family-members', 'src/app/family/members.tsx', 'default', {}, 'Участники семьи'],
  ['family-join', 'src/app/family/join.tsx', 'default', {}, 'Принять приглашение'],
  ['family-trash', 'src/app/family/trash.tsx', 'default', {}, 'Корзина'],
  ['capsule-member-gate', 'src/app/family/capsules.tsx', 'default', {}, 'Раздел доступен только создателю семьи'],
  ['memory-edit', 'src/app/memory/[id].tsx', 'default', {}, 'Дата события'],
  ['status', 'src/components/app-status-screen.tsx', 'AppStatusScreen', { title: 'Открываем историю', loading: true }, 'Открываем историю'],
  ['plain-gallery', 'src/components/memory-gallery.tsx', 'MemoryGallery', { memories: [
    { id: 'demo-memory', title: 'Первый месяц', event_date: '2024-02-29', child_ids: ['demo-child'], media: [
      { id: 'demo-photo', media_type: 'image', signed_url: 'https://preview.example.invalid/photo' },
      { id: 'demo-photo-2', media_type: 'image', signed_url: 'https://preview.example.invalid/photo-2' },
      { id: 'demo-video', media_type: 'video', signed_url: 'https://preview.example.invalid/video' },
    ] },
  ], mediaKind: 'image', captionFor: () => 'Александра · 1 месяц' }, 'Открыть фото'],
  ['video-list', 'src/components/memory-video-list.tsx', 'MemoryVideoList', { memories: [
    { id: 'demo-video-entry', title: 'Первая прогулка', event_date: '2024-03-01', child_ids: [], media: [
      { id: 'demo-clip', media_type: 'video', signed_url: 'https://preview.example.invalid/video' },
    ] },
  ], captionFor: () => undefined }, 'Нажмите, чтобы смотреть'],
  ['memory-list', 'src/components/memory-list.tsx', 'MemoryList', { memories: [
    { id: 'demo-entry', title: 'Семейный день', body: 'Несекретный текст для статической проверки', event_date: '2024-03-01', child_ids: ['demo-child'], media: [] },
  ], ageFor: () => 'Нам 2 месяца' }, 'Семейный день'],
  ['diary-sections', 'src/components/diary-categories.tsx', 'DiaryCategories', { selected: 'skills', showAll: true, onSelect: noWrite }, 'Новые умения'],
  ['diary-list', 'src/components/memory-diary-list.tsx', 'MemoryDiaryList', { memories: [
    { id: 'demo-diary', title: 'Первое мама', body: 'Слова для родных', event_date: '2024-03-01', memory_type: 'note', diary_category: 'words', child_ids: [], media: [] },
  ], captionFor: () => 'Александра' }, 'Первые слова'],
  ['video-viewer', 'src/components/video-viewer.tsx', 'VideoViewer', { media: { id: 'demo-video', signed_url: 'https://preview.example.invalid/video', media_type: 'video' },
    title: 'Видео из семейной истории', caption: '15 марта 2024', onClose: noWrite }, 'Видео воспоминания'],
  ['voice-recorder', 'src/components/voice-recorder.tsx', 'VoiceRecorder', { disabled: false, canAdd: true, onChange: noWrite, onBusyChange: noWrite }, 'Голос на память'],
  ['audio-viewer', 'src/components/audio-viewer.tsx', 'AudioViewer', { media: { id: 'demo-voice', media_type: 'audio', signed_url: 'https://preview.example.invalid/voice' },
    title: 'Первое мама', caption: 'Александра', onClose: noWrite }, 'Прослушать голос'],
];
for (const [label, file, name, props, expected] of pages) {
  const component = loadTypescript(file, mocks)[name];
  const html = renderToStaticMarkup(React.createElement(component, props));
  assert.ok(html.includes(expected), label + ': expected actual UI content');
  assert.ok(!html.includes('ImageBackground'), label + ': no screen-sized bitmap UI');
  console.log(label + ': rendered');
}
routeParams = { diary: '1', category: 'skills', childId: 'demo-child' };
const diaryForm = loadTypescript('src/app/memory/new.tsx', mocks).default;
const diaryHtml = renderToStaticMarkup(React.createElement(diaryForm));
assert.ok(diaryHtml.includes('Новые умения') && diaryHtml.includes('Первые шаги') && diaryHtml.includes('Выбрать фото или видео'));
console.log('diary-form: rendered');
routeParams = { id: 'demo-child' };
auth = { ...auth, family: { status: 'multiple', choices: [{ id: 'demo-family', name: 'Семья Ивановых', role: 'owner' }] } };
const picker = loadTypescript('src/app/family-picker.tsx', mocks).default;
assert.ok(renderToStaticMarkup(React.createElement(picker)).includes('Семья Ивановых'));
console.log('family-picker: rendered');

auth = { session: { user: { id: 'demo-user', email: 'demo@example.invalid' } },
  family: { ...family, family: { ...family.family, role: 'owner' } } };
const capsulePage = loadTypescript('src/app/family/capsules.tsx', mocks).default;
const capsuleHtml = renderToStaticMarkup(React.createElement(capsulePage));
assert.ok(capsuleHtml.includes('Личное послание в будущее') && capsuleHtml.includes('Даты открытия нет'));
assert.ok(!capsuleHtml.includes('Привет, взрослая Ася'));
console.log('capsule-owner-gate: rendered');

// Shared only by the local static visual diagnostic, never imported by the app.
module.exports = { mocks, setPreviewAuth(value) { auth = value; } };
