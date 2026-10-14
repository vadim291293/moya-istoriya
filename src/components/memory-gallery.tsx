import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FamilyMemory, MemoryMedia } from '../lib/memory-service';
import { galleryRows, type GalleryItem, type GalleryRow } from '../lib/memory-gallery';
import { formatRuDate } from '../lib/date-utils';
import { colors } from '../lib/theme';
import type { MemoryListChrome } from './memory-list';
import { useMemoryMediaViewer, type MemoryEditingActions } from './use-memory-media-viewer';
import { StoryIcon } from './story-ui';

export function GalleryTile({ item, onPress }: {
  item: GalleryItem; onPress: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const source = useRef(item.media.signed_url); source.current = item.media.signed_url;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setFailed(false); }, [item.media.signed_url]);
  const video = item.media.media_type === 'video';
  const displayedSource = item.media.signed_url;
  return <Pressable accessibilityRole="button"
    accessibilityLabel={`${video ? 'Открыть видео' : 'Открыть фото'}: ${item.memory.title || formatRuDate(item.memory.event_date)}`}
    onPress={() => { if (mounted.current && source.current === displayedSource) onPress(); }}
    style={({ pressed }) => [styles.tile, video && styles.videoTile, pressed && styles.pressed]}>
    {!video && item.media.signed_url && !failed ? <Image source={{ uri: item.media.signed_url }} resizeMode="contain"
      style={styles.image} onError={() => { if (mounted.current && source.current === displayedSource) setFailed(true); }} /> : <StoryIcon name="photo" size={28} color={video ? '#FFFFFF' : colors.secondary} />}
    {video ? <View pointerEvents="none" style={styles.play}><Text style={styles.playText}>▶</Text><Text style={styles.videoText}>Видео</Text></View> : null}
    {!item.media.signed_url || failed ? <Text style={[styles.unavailable, video && styles.lightText]}>Недоступно</Text> : null}
  </Pressable>;
}

export function MemoryGallery({ memories, captionFor, chrome = {}, mediaKind, onEditMemory, canEditMemory }: {
  memories: FamilyMemory[]; captionFor: (memory: FamilyMemory) => string | undefined; chrome?: MemoryListChrome;
  mediaKind?: MemoryMedia['media_type'];
} & MemoryEditingActions) {
  const rows = useMemo(() => galleryRows(memories, mediaKind), [memories, mediaKind]);
  const { open, viewer } = useMemoryMediaViewer(memories, captionFor, 'album', { onEditMemory, canEditMemory });
  const renderRow = useCallback(({ item: row }: { item: GalleryRow }) => <View style={styles.grid}>
        {row.items.map((item) => <View key={item.key} style={styles.cell}>
          <GalleryTile item={item} onPress={() => open(item.memory, item.media)} />
        </View>)}
        {Array.from({ length: 2 - row.items.length }, (_, index) => <View key={`empty-${index}`}
          style={styles.cell} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />)}
  </View>, [open]);
  return <View style={styles.frame}>
    <FlatList<GalleryRow> {...chrome} style={[styles.frame, chrome.style]} data={rows}
      keyExtractor={(row) => row.key} renderItem={renderRow} showsVerticalScrollIndicator={false}
      initialNumToRender={4} maxToRenderPerBatch={6} windowSize={7} removeClippedSubviews={false} />
    {viewer}
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  grid: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  cell: { flex: 1 },
  tile: { width: '100%', aspectRatio: 1, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', borderRadius: 12 },
  image: { width: '100%', height: '100%' },
  videoTile: { backgroundColor: '#8270AD' },
  play: { position: 'absolute', alignItems: 'center', gap: 6 },
  playText: { color: '#FFFFFF', fontSize: 22 },
  videoText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  unavailable: { color: colors.secondary, fontSize: 10, position: 'absolute', bottom: 8 },
  lightText: { color: '#FFFFFF' },
  pressed: { opacity: 0.75 },
});
