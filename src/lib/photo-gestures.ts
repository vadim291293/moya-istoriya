export function clampPhotoScale(value: number) {
  'worklet';
  return Math.max(1, Math.min(5, value));
}

export function photoPanBounds(viewWidth: number, viewHeight: number, imageWidth: number, imageHeight: number, scale: number) {
  'worklet';
  if (viewWidth <= 0 || viewHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return { x: 0, y: 0 };
  const fit = Math.min(viewWidth / imageWidth, viewHeight / imageHeight);
  return { x: Math.max(0, (imageWidth * fit * scale - viewWidth) / 2),
    y: Math.max(0, (imageHeight * fit * scale - viewHeight) / 2) };
}

export function clampPhotoOffset(value: number, bound: number) {
  'worklet';
  return Math.max(-bound, Math.min(bound, value));
}

export function photoSwipeDirection(x: number, y: number, velocityX: number, zoom: number, multiTouch: boolean): -1 | 0 | 1 {
  'worklet';
  if (zoom > 1.05 || multiTouch || Math.abs(x) < Math.abs(y) * 1.5) return 0;
  if (Math.abs(x) < 50 && !(Math.abs(x) >= 18 && Math.abs(velocityX) >= 600)) return 0;
  return x < 0 ? 1 : -1;
}
