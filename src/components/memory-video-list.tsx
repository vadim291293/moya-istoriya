import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';
import { formatRuDate } from '../lib/date-utils';
import type { GalleryItem } from '../lib/memory-gallery';
import type { FamilyMemory } from '../lib/memory-service';
import { colors } from '../lib/theme';
import type { MemoryListChrome } from './memory-list';
import { StoryIcon } from './story-ui';
import { useMemoryMediaViewer, type MemoryEditingActions } from './use-memory-media-viewer';
import { createVideoPosterQueue } from '../lib/video-poster-queue';
import { nativePosterPlayer } from '../lib/video-poster-player';

type PosterQueue = ReturnType<typeof createVideoPosterQueue<VideoThumbnail>>;
export function VideoListItem({ item, onPress, posterQueue }: { item: GalleryItem; onPress: () => void; posterQueue?: PosterQueue | null }) {
  const mounted = useRef(true);
  const latest = useRef(item); latest.current = item;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [poster, setPoster] = useState<{ uri: string; queue: PosterQueue; image: VideoThumbnail } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const uri = item.media.signed_url;
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (uri && posterQueue) void posterQueue.get(uri).then((image) => {
      if (!live || !mounted.current) return;
      if (image) setPoster({ uri, queue: posterQueue, image });
      else setFailed(true);
    });
    return () => { live = false; };
  }, [uri, posterQueue, retry]);
  const image = poster?.uri === uri && poster.queue === posterQueue ? poster.image : null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Открыть видео: ${item.memory.title || formatRuDate(item.memory.event_date)}`}
    onPress={() => { if (mounted.current && latest.current.memory === item.memory && latest.current.media === item.media) onPress(); }}
    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <View style={styles.preview}>
      {image ? <Image source={image} contentFit="contain" cachePolicy="none" style={styles.poster} accessibilityLabel="Кадр из видео" /> :
        !uri ? <Text style={styles.previewHint}>Нет доступа</Text> : failed || Platform.OS === 'web'
          ? <Text style={styles.previewHint}>Кадр недоступен</Text>
          : <ActivityIndicator color={colors.primary} accessibilityLabel="Загружаем кадр видео" />}
      <View style={styles.play}><StoryIcon name="play" size={20} color="#FFFFFF" /></View>
    </View>
    <View style={styles.info}>
      {item.memory.title ? <Text numberOfLines={2} style={styles.title}>{item.memory.title}</Text> : null}
      <Text style={styles.date}>{formatRuDate(item.memory.event_date)}</Text>
      <Text style={styles.hint}>{item.media.signed_url ? 'Нажмите, чтобы смотреть' : 'Файл пока недоступен'}</Text>
      {failed && uri ? <Pressable accessibilityRole="button" accessibilityLabel="Повторить загрузку кадра видео"
        onPress={(event) => { event.stopPropagation(); if (mounted.current) setRetry(value => value + 1); }} style={styles.retry}>
        <Text style={styles.hint}>Повторить загрузку обложки</Text>
      </Pressable> : null}
    </View>
  </Pressable>;
}

// One bounded, non-playing thumbnail extractor; playback mounts only on a tap.
export function MemoryVideoList({ memories, captionFor, chrome = {}, onEditMemory, canEditMemory }: {
  memories: FamilyMemory[];
  captionFor: (memory: FamilyMemory) => string | undefined;
  chrome?: MemoryListChrome;
} & MemoryEditingActions) {
  const focused = useIsFocused();
  const currentQueue = useRef<PosterQueue | null>(null);
  const [foreground, setForeground] = useState(!AppState.currentState || AppState.currentState === 'active');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') currentQueue.current?.dispose();
      setForeground(state === 'active');
    });
    return () => listener.remove();
  }, []);
  const [posterQueue, setPosterQueue] = useState<PosterQueue | null>(null);
  useEffect(() => {
    // Create in effect setup, not useMemo: Strict Mode's setup/cleanup/setup
    // must not leave rows attached to an already disposed queue.
    const queue = focused && foreground && Platform.OS !== 'web'
      ? createVideoPosterQueue<VideoThumbnail>(nativePosterPlayer) : null;
    currentQueue.current = queue;
    setPosterQueue(queue);
    return () => { queue?.dispose(); if (currentQueue.current === queue) currentQueue.current = null; };
  }, [focused, foreground]);
  currentQueue.current = posterQueue;
  const videos = useMemo(() => memories.flatMap((memory) => memory.media
    .filter((media) => media.media_type === 'video')
    .map((media): GalleryItem => ({ key: `${memory.id}:${media.id}`, memory, media }))), [memories]);
  const { open, viewer } = useMemoryMediaViewer(memories, captionFor, 'album', { onEditMemory, canEditMemory });
  const renderVideo = useCallback(({ item }: { item: GalleryItem }) =>
    <VideoListItem item={item} posterQueue={posterQueue} onPress={() => open(item.memory, item.media)} />, [open, posterQueue]);
  return <View style={styles.frame}>
    <FlatList<GalleryItem> {...chrome} style={[styles.frame, chrome.style]} data={videos}
      keyExtractor={(item) => item.key} renderItem={renderVideo} showsVerticalScrollIndicator={false}
      initialNumToRender={6} maxToRenderPerBatch={6} windowSize={7} removeClippedSubviews={false} />
    {viewer}
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 98, padding: 14, marginBottom: 10, backgroundColor: colors.surface, borderRadius: 20 },
  preview: { width: 96, height: 112, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  poster: { width: '100%', height: '100%' },
  play: { position: 'absolute', width: 32, height: 32, bottom: 8, right: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#372E57B3' },
  previewHint: { fontSize: 12, color: colors.secondary },
  info: { flex: 1 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.ink },
  date: { fontSize: 12, color: colors.secondary, marginTop: 4 },
  hint: { fontSize: 11, color: colors.primary, marginTop: 5 },
  retry: { minHeight: 44, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
