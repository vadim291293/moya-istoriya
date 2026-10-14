import { useCallback } from 'react';
import { FlatList, StyleSheet, View, type FlatListProps } from 'react-native';
import type { FamilyMemory } from '../lib/memory-service';
import { MemoryCard } from './memory-card';
import { useMemoryMediaViewer, type MemoryEditingActions } from './use-memory-media-viewer';

export type MemoryListChrome = Pick<FlatListProps<unknown>, 'style' | 'contentContainerStyle'
  | 'ListHeaderComponent' | 'ListFooterComponent' | 'ListEmptyComponent' | 'refreshControl'
  | 'onEndReached' | 'onEndReachedThreshold'>;

export function MemoryList({ memories, ageFor, contextFor, chrome = {}, onEditMemory, canEditMemory }: {
  memories: FamilyMemory[];
  ageFor?: (memory: FamilyMemory) => string | undefined;
  contextFor?: (memory: FamilyMemory) => string | undefined;
  chrome?: MemoryListChrome;
} & MemoryEditingActions) {
  const captionFor = useCallback((memory: FamilyMemory) => ageFor?.(memory) ?? contextFor?.(memory), [ageFor, contextFor]);
  const { open, viewer } = useMemoryMediaViewer(memories, captionFor, 'memory', { onEditMemory, canEditMemory });
  return <View style={styles.frame}>
    <FlatList<FamilyMemory> {...chrome} style={[styles.frame, chrome.style]} data={memories}
      keyExtractor={(memory) => memory.id} showsVerticalScrollIndicator={false}
      initialNumToRender={3} maxToRenderPerBatch={3} windowSize={7} removeClippedSubviews={false}
      renderItem={({ item }) => <View style={styles.row}>
        <MemoryCard memory={item} ageCaption={ageFor?.(item)} contextLabel={contextFor?.(item)} onOpenMedia={open}
          onEdit={canEditMemory?.(item) ? () => onEditMemory?.(item) : undefined} />
      </View>} />
    {viewer}
  </View>;
}

const styles = StyleSheet.create({ frame: { flex: 1 }, row: { marginBottom: 12 } });
