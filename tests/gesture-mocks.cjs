// Callback/configuration tests only: not a native touch-recognition simulator.
function gesture(kind) {
  const result = { kind, callbacks: {}, config: {} };
  for (const name of ['onStart', 'onUpdate', 'onEnd', 'onFinalize']) result[name] = (callback) => { result.callbacks[name] = callback; return result; };
  for (const name of ['minDistance', 'averageTouches', 'numberOfTaps', 'maxDelay']) result[name] = (value) => { result.config[name] = value; return result; };
  return result;
}
function gestureMocks(react) {
  return {
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureHandlerRootView', GestureDetector: 'GestureDetector',
      Gesture: { Pinch: () => gesture('pinch'), Pan: () => gesture('pan'), Tap: () => gesture('tap'), Simultaneous: (...gestures) => ({ gestures }) } },
    'react-native-reanimated': { __esModule: true, default: { Image: 'Image', View: 'View' },
      useSharedValue(initial) { const ref = react.useRef(initial); return react.useMemo(() => ({ get: () => ref.current, set: (value) => { ref.current = value; } }), []); },
      useAnimatedStyle: (callback) => callback(), withTiming: (value) => value, runOnJS: (callback) => callback },
  };
}
module.exports = { gestureMocks };
