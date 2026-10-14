import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { MemoryMedia } from '../lib/memory-service';
import { StoryIcon } from './story-ui';
import { ZoomablePhoto } from './zoomable-photo';

export function PhotoViewer({ photos, initialId, title, caption, onClose, onEdit }: {
  photos: (MemoryMedia & { viewerTitle?: string; viewerCaption?: string; viewerMemoryId?: string; viewerCanEdit?: boolean })[];
  initialId: string; title: string; caption: string; onClose: () => void;
  onEdit?: (memoryId: string) => void;
}) {
  const alive = useRef(true);
  const closing = useRef(false);
  const closeCallback = useRef(onClose);
  const editCallback = useRef(onEdit); editCallback.current = onEdit;
  closeCallback.current = onClose;
  const currentPhotos = useRef(photos);
  currentPhotos.current = photos;
  const close = useCallback(() => {
    if (!alive.current || closing.current) return;
    closing.current = true;
    closeCallback.current();
  }, []);
  const [selectedId, setSelectedId] = useState(initialId);
  const index = Math.max(0, photos.findIndex((photo) => photo.id === selectedId));
  const photo = photos[index];
  const displayedTitle = photo?.viewerTitle ?? title;
  const displayedCaption = photo?.viewerCaption ?? caption;
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [zoomRequest, setZoomRequest] = useState<{ photoKey: string; version: number } | null>(null);
  const photoKey = `${photo?.id}:${photo?.signed_url}`;
  const activePhotoKey = useRef(photoKey);
  activePhotoKey.current = photoKey;
  const isCurrentPhoto = useCallback(() => alive.current && !closing.current && activePhotoKey.current === photoKey, [photoKey]);
  const onZoom = useCallback((value: boolean) => { if (isCurrentPhoto()) setZoomed(value); }, [isCurrentPhoto]);
  useEffect(() => {
    if (!alive.current || closing.current) return;
    setLoading(true); setFailed(false); setZoomed(false);
  }, [photo?.id, photo?.signed_url]);
  useEffect(() => {
    alive.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') close();
    });
    if (AppState.currentState && AppState.currentState !== 'active') close();
    return () => { alive.current = false; subscription.remove(); };
  }, [close]);

  const move = useCallback((direction: -1 | 1) => {
    if (!alive.current || closing.current) return;
    setSelectedId((current) => {
      const currentIndex = Math.max(0, currentPhotos.current.findIndex((item) => item.id === current));
      return currentPhotos.current[currentIndex + direction]?.id ?? current;
    });
  }, []);
  const onPhotoMove = useCallback((direction: -1 | 1) => {
    if (isCurrentPhoto()) move(direction);
  }, [isCurrentPhoto, move]);

  return <Modal animationType="fade" presentationStyle="fullScreen" onRequestClose={close}
    supportedOrientations={['portrait', 'landscape']} visible>
    <GestureHandlerRootView style={styles.screen}><SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.heading}><Text numberOfLines={2} style={styles.title}>{displayedTitle}</Text><Text style={styles.caption}>{displayedCaption}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть фотографию" onPress={close} style={styles.close}><StoryIcon name="close" color="#FFFFFF" /></Pressable>
      </View>
      <View style={styles.stage} accessible accessibilityRole="adjustable" accessibilityLabel={`Фотография ${index + 1} из ${photos.length}. ${displayedCaption}`}
        accessibilityActions={[{ name: 'increment', label: 'Следующее фото' }, { name: 'decrement', label: 'Предыдущее фото' }]}
        onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'increment') move(1); else if (event.nativeEvent.actionName === 'decrement') move(-1); }}>
        {photo?.signed_url && !failed ? <>
          <ZoomablePhoto key={`${photo.id}:${photo.signed_url}`} uri={photo.signed_url}
            label={`Фотография ${index + 1} из ${photos.length}`} resetVersion={resetVersion}
            zoomVersion={zoomRequest?.photoKey === photoKey ? zoomRequest.version : 0} onMove={onPhotoMove} onZoom={onZoom}
            onLoadStart={() => { if (isCurrentPhoto()) setLoading(true); }}
            onLoad={() => { if (isCurrentPhoto()) setLoading(false); }}
            onError={() => { if (isCurrentPhoto()) { setFailed(true); setLoading(false); setZoomed(false); } }} />
          {loading ? <ActivityIndicator pointerEvents="none" color="#FFFFFF" size="large" style={styles.loader} /> : null}
        </> : <View style={styles.unavailable}>
          <Text style={styles.title}>Не удалось открыть фото</Text>
          <Text style={styles.errorText}>Закройте просмотр и потяните галерею вниз, чтобы обновить доступ.</Text>
        </View>}
      </View>
      <View style={styles.footer}>
        {photo?.viewerCanEdit && photo.viewerMemoryId && onEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Изменить воспоминание"
          style={styles.reset} onPress={() => { if (isCurrentPhoto() && photo.viewerMemoryId) editCallback.current?.(photo.viewerMemoryId); }}>
          <Text style={styles.resetText}>Изменить запись · корзина</Text>
        </Pressable> : null}
        <View style={styles.counterRow}><Text accessibilityLiveRegion="polite" style={styles.counter}>{index + 1} / {photos.length}</Text>
          {!failed && photo?.signed_url ? <Pressable accessibilityRole="button" accessibilityLabel={zoomed ? 'Сбросить увеличение' : 'Увеличить фото'}
            onPress={() => { if (!isCurrentPhoto()) return; if (zoomed) setResetVersion((value) => value + 1); else setZoomRequest((previous) => ({ photoKey, version: previous?.photoKey === photoKey ? previous.version + 1 : 1 })); }} style={styles.reset}><Text style={styles.resetText}>{zoomed ? 'Исходный размер' : 'Увеличить'}</Text></Pressable> : null}
        </View>
        {photos.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnails} style={styles.thumbnailStrip}>{photos.map((item, itemIndex) => <Pressable key={item.id}
          accessibilityRole="button" accessibilityLabel={`Открыть фото ${itemIndex + 1}`} accessibilityState={{ selected: item.id === photo?.id }}
          onPress={() => { if (alive.current && !closing.current && currentPhotos.current.some((current) => current.id === item.id)) setSelectedId(item.id); }} style={[styles.thumb, item.id === photo?.id && styles.selectedThumb]}>
          {item.signed_url ? <Image source={{ uri: item.signed_url }} style={styles.thumbImage} /> : <Text style={styles.counter}>{itemIndex + 1}</Text>}
        </Pressable>)}</ScrollView> : null}
        <Text style={styles.gestureHint}>{zoomed ? 'Перемещайте фото пальцем' : photos.length > 1 ? 'Свайп — листать · двойной тап — увеличить' : 'Двойной тап или два пальца — увеличить'}</Text>
      </View>
    </SafeAreaView></GestureHandlerRootView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#191720' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  heading: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', lineHeight: 24 },
  caption: { color: '#CBC5D2', fontSize: 12, lineHeight: 18, marginTop: 4 },
  close: { minWidth: 44, minHeight: 44, borderRadius: 16, backgroundColor: '#302C3B', alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, minHeight: 80, position: 'relative', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  loader: { position: 'absolute' },
  unavailable: { padding: 24, alignItems: 'center' },
  errorText: { color: '#CBC5D2', textAlign: 'center', fontSize: 14, lineHeight: 22, marginTop: 10 },
  footer: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, paddingTop: 4 },
  counterRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 16 },
  counter: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  reset: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  resetText: { color: '#F6BCA9', fontSize: 12, fontWeight: '600' },
  thumbnailStrip: { maxWidth: '100%' },
  thumbnails: { gap: 8 },
  thumb: { width: 44, height: 46, padding: 2, borderWidth: 2, borderColor: 'transparent', borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  selectedThumb: { borderColor: '#F6BCA9' },
  thumbImage: { width: '100%', height: '100%', borderRadius: 5 },
  gestureHint: { color: '#CBC5D2', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 10 },
});
