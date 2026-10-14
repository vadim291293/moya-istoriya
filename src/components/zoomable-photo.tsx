import { useEffect } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { ImageLoadEventData, NativeSyntheticEvent } from 'react-native';
import { clampPhotoOffset, clampPhotoScale, photoPanBounds, photoSwipeDirection } from '../lib/photo-gestures';

export function ZoomablePhoto({ uri, label, resetVersion, zoomVersion = 0, onMove, onZoom, onLoadStart, onLoad, onError }: {
  uri: string; label: string; resetVersion: number; zoomVersion?: number; onMove: (direction: -1 | 1) => void;
  onZoom: (zoomed: boolean) => void; onLoadStart: () => void;
  onLoad: () => void; onError: () => void;
}) {
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startScale = useSharedValue(1);
  const anchor = useSharedValue({ x: 0, y: 0 });
  const panStart = useSharedValue({ x: 0, y: 0 });
  const multiTouch = useSharedValue(false);
  const pinching = useSharedValue(false);
  const viewport = useSharedValue({ width: 0, height: 0 });
  const imageSize = useSharedValue({ width: 0, height: 0 });

  useEffect(() => {
    scale.set(withTiming(1, { duration: 160 }));
    x.set(withTiming(0, { duration: 160 }));
    y.set(withTiming(0, { duration: 160 }));
    onZoom(false);
  }, [resetVersion, uri, scale, x, y, onZoom]);
  useEffect(() => {
    if (zoomVersion === 0) return;
    scale.set(withTiming(2.5, { duration: 160 })); x.set(0); y.set(0); onZoom(true);
  }, [zoomVersion, scale, x, y, onZoom]);

  function bounds(zoom: number) {
    'worklet';
    const view = viewport.get(), image = imageSize.get();
    return photoPanBounds(view.width, view.height, image.width, image.height, zoom);
  }

  const pinch = Gesture.Pinch().onStart((event) => {
    pinching.set(true);
    multiTouch.set(true);
    startScale.set(scale.get());
    const view = viewport.get();
    anchor.set({ x: (event.focalX - view.width / 2 - x.get()) / scale.get(),
      y: (event.focalY - view.height / 2 - y.get()) / scale.get() });
  }).onUpdate((event) => {
    const zoom = clampPhotoScale(startScale.get() * event.scale);
    const limit = bounds(zoom), view = viewport.get(), point = anchor.get();
    scale.set(zoom);
    x.set(clampPhotoOffset(event.focalX - view.width / 2 - point.x * zoom, limit.x));
    y.set(clampPhotoOffset(event.focalY - view.height / 2 - point.y * zoom, limit.y));
  }).onFinalize(() => {
    pinching.set(false);
    if (scale.get() <= 1.05) { scale.set(withTiming(1)); x.set(withTiming(0)); y.set(withTiming(0)); }
    runOnJS(onZoom)(scale.get() > 1.05);
  });

  const pan = Gesture.Pan().minDistance(8).averageTouches(true).onStart((event) => {
    panStart.set({ x: x.get(), y: y.get() });
    multiTouch.set(event.numberOfPointers > 1 || pinching.get());
  }).onUpdate((event) => {
    if (event.numberOfPointers > 1) multiTouch.set(true);
    if (pinching.get() || multiTouch.get()) return;
    if (scale.get() > 1.05) {
      const limit = bounds(scale.get()), start = panStart.get();
      x.set(clampPhotoOffset(start.x + event.translationX, limit.x));
      y.set(clampPhotoOffset(start.y + event.translationY, limit.y));
    } else if (!multiTouch.get()) {
      x.set(clampPhotoOffset(event.translationX * 0.25, 40));
    }
  }).onEnd((event) => {
    const direction = photoSwipeDirection(event.translationX, event.translationY, event.velocityX, scale.get(), multiTouch.get());
    if (direction) runOnJS(onMove)(direction);
  }).onFinalize(() => {
    if (scale.get() <= 1.05) { x.set(withTiming(0)); y.set(withTiming(0)); }
  });

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(280).onEnd((event, success) => {
    if (!success) return;
    const zoom = scale.get() > 1.05 ? 1 : 2.5;
    const limit = bounds(zoom), view = viewport.get();
    x.set(withTiming(zoom === 1 ? 0 : clampPhotoOffset((view.width / 2 - event.x) * (zoom - 1), limit.x)));
    y.set(withTiming(zoom === 1 ? 0 : clampPhotoOffset((view.height / 2 - event.y) * (zoom - 1), limit.y)));
    scale.set(withTiming(zoom));
    runOnJS(onZoom)(zoom > 1.05);
  });
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));

  function loaded(event: NativeSyntheticEvent<ImageLoadEventData>) {
    const source = event.nativeEvent.source;
    if (source?.width > 0 && source?.height > 0) imageSize.set({ width: source.width, height: source.height });
    onLoad();
  }

  return <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)} touchAction="none">
    <Animated.View style={{ flex: 1, width: '100%', overflow: 'hidden' }} collapsable={false}
      onLayout={(event) => {
        viewport.set({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });
        // A rotation/layout change resets the image into the new visible bounds.
        scale.set(1); x.set(0); y.set(0); onZoom(false);
      }}>
      <Animated.Image source={{ uri }} resizeMode="contain" accessibilityLabel={label}
        onLoadStart={onLoadStart} onLoad={loaded} onError={onError}
        style={[{ width: '100%', height: '100%' }, transform]} />
    </Animated.View>
  </GestureDetector>;
}
