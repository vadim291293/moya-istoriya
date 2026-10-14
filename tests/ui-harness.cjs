const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const { gestureMocks } = require('./gesture-mocks.cjs');

// Lightweight handler/effect tests, not a substitute for a native rendering test.
function screenHarness(filename, mocks = {}, exportName = 'default', globals = {}) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let tree;
  let lastProps;
  let stateWrites = 0;
  const react = {
    createContext: (value) => ({ Provider: 'ContextProvider', defaultValue: value }),
    useState(initial) {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial;
      return [hooks[slot], (value) => { stateWrites++; hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value; }];
    },
    useRef(initial) {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = { current: initial };
      return hooks[slot];
    },
    useMemo(factory, deps) {
      const slot = cursor++;
      const previous = hooks[slot];
      if (!previous || !deps || deps.length !== previous.deps?.length || deps.some((value, index) => !Object.is(previous.deps[index], value))) {
        hooks[slot] = { deps, value: factory() };
      }
      return hooks[slot].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const slot = cursor++;
      const previous = hooks[slot];
      if (!previous || !deps || deps.some((value, index) => !Object.is(previous.deps[index], value))) {
        effects.push(() => { previous?.cleanup?.(); hooks[slot] = { deps, cleanup: callback() }; });
      }
    },
  };
  const native = Object.fromEntries(['ActivityIndicator', 'FlatList', 'Image', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'RefreshControl', 'ScrollView', 'Text', 'TextInput', 'View'].map((name) => [name, name]));
  Object.assign(native, { StyleSheet: { create: (value) => value }, Keyboard: { dismiss() {} },
    Platform: { OS: 'android' }, AppState: { addEventListener: () => ({ remove() {} }) } });
  // Most screen tests isolate the picker service; its real journal/controller
  // has separate tests. Dedicated recovery tests override this module below.
  const pickerMock = {
    hasPendingMediaPicker: () => false, recoverFamilyMedia: async () => null,
    finishMediaPicker() {}, clearMediaPickerBeforeSave() {}, MediaPickerError: class extends Error {},
    chooseFamilyMedia: async (scope, snapshot) => {
      const result = await mocks['expo-image-picker'].launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 5,
        allowsEditing: false, quality: 1, exif: true,
      });
      return { ...scope, id: null, snapshot, outcome: { status: result.canceled ? 'cancelled' : 'selected', assets: result.assets ?? [] } };
    },
  };
  const component = loadTypescript(filename, { react, 'react-native': native, ...gestureMocks(react),
    '../../lib/media-picker': pickerMock,
    'expo-image': { Image: 'ExpoImage' },
    'expo-video': { createVideoPlayer() { throw new Error('No native thumbnail extraction in a handler test'); } },
    'expo-file-system': { File: class { constructor(uri) { this.uri = uri; this.size = 128; } } },
    'expo-file-system/legacy': {},
    'expo-crypto': { randomUUID: () => 'synthetic-poster-id' },
    'expo-audio': {
      RecordingPresets: { HIGH_QUALITY: {} }, AudioModule: { requestRecordingPermissionsAsync: async () => ({ granted: true }) },
      setAudioModeAsync: async () => {},
      useAudioRecorder: () => ({ uri: 'file:///voice.m4a', prepareToRecordAsync: async () => {}, record() {}, stop: async () => {} }),
      useAudioRecorderState: () => ({ durationMillis: 0, isRecording: false }),
      useAudioPlayer: () => ({ currentTime: 0, duration: 0, playing: false, pause() {}, play() {}, seekTo: async () => {}, addListener: () => ({ remove() {} }) }),
      useAudioPlayerStatus: () => ({ currentTime: 0, duration: 0, playing: false, isLoaded: true }),
    },
    './memory-diary-list': { MemoryDiaryList: 'MemoryDiaryList' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native-svg': { __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path', Rect: 'Rect' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, ...mocks }, globals)[exportName];
  function visit(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const child of node) { const result = visit(child, predicate); if (result) return result; } return null; }
    if (predicate(node)) return node;
    // Traverse synthetic list contents for handler assertions only. This is eager
    // and does not simulate native windowing, scrolling, measurement or recycling.
    if (node.type === 'FlatList') {
      const { data = [], renderItem, ListHeaderComponent, ListEmptyComponent, ListFooterComponent } = node.props;
      return visit([ListHeaderComponent, data.length ? data.map((item, index) => renderItem({ item, index })) : ListEmptyComponent,
        ListFooterComponent], predicate);
    }
    if (node.props?.chrome && ['MemoryGallery', 'MemoryVideoList', 'MemoryList', 'MemoryDiaryList'].includes(node.type)) {
      const { ListHeaderComponent, ListEmptyComponent, ListFooterComponent } = node.props.chrome;
      const empty = node.type === 'MemoryGallery'
        ? !node.props.memories?.some((memory) => memory.media.some(media => !node.props.mediaKind || media.media_type === node.props.mediaKind))
        : node.type === 'MemoryVideoList' ? !node.props.memories?.some(memory => memory.media.some(media => media.media_type === 'video')) : !node.props.memories?.length;
      return visit([ListHeaderComponent, empty ? ListEmptyComponent : null, ListFooterComponent], predicate);
    }
    return visit(node.props?.children, predicate);
  }
  return {
    react,
    get stateWrites() { return stateWrites; },
    render(props = lastProps) { lastProps = props; cursor = 0; effects = []; tree = component(props); for (const effect of effects) effect(); return tree; },
    find(predicate) { const found = visit(tree, predicate); assert.ok(found, 'Expected UI element'); return found; },
    field(label) { return this.find((node) => node.type === 'TextInput' && node.props.accessibilityLabel === label).props; },
    button(label) { return this.find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === label).props; },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); },
  };
}
module.exports = { screenHarness };
