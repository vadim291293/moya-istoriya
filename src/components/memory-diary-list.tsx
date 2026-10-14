import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { diaryCategories, diaryCategoryFor } from '../lib/diary';
import { formatRuDate } from '../lib/date-utils';
import type { FamilyMemory } from '../lib/memory-service';
import { colors } from '../lib/theme';
import { MemoryCard } from './memory-card';
import type { MemoryListChrome } from './memory-list';
import { useMemoryMediaViewer, type MemoryEditingActions } from './use-memory-media-viewer';

export function MemoryDiaryList({ memories, captionFor, chrome = {}, onEditMemory, canEditMemory }: {
  memories: FamilyMemory[]; captionFor: (memory: FamilyMemory) => string | undefined;
  chrome?: MemoryListChrome;
} & MemoryEditingActions) {
  const focused = useIsFocused();
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const alive = useRef(true);
  const foreground = useRef(!AppState.currentState || AppState.currentState === 'active');
  const latest = useRef(memories); latest.current = memories;
  const [expanded, setExpanded] = useState<string | null>(null);
  const { open, viewer } = useMemoryMediaViewer(memories, captionFor, 'memory', { onEditMemory, canEditMemory });
  const toggle = useCallback((memory: FamilyMemory) => {
    if (alive.current && focusedRef.current && foreground.current && latest.current.includes(memory)) {
      setExpanded((id) => id === memory.id ? null : memory.id);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (!foreground.current && alive.current) setExpanded(null);
    });
    return () => { alive.current = false; subscription.remove(); };
  }, []);
  useEffect(() => { if (!focused) setExpanded(null); }, [focused]);
  return <View style={styles.frame}>
    <FlatList<FamilyMemory> {...chrome} data={memories.filter((memory) => diaryCategoryFor(memory))}
      extraData={expanded} style={[styles.frame, chrome.style]} keyExtractor={(memory) => memory.id}
      initialNumToRender={5} maxToRenderPerBatch={5} windowSize={7} removeClippedSubviews={false}
      showsVerticalScrollIndicator={false} renderItem={({ item }) => {
        const category = diaryCategories.find((entry) => entry.id === diaryCategoryFor(item))!;
        const isExpanded = expanded === item.id;
        return <View style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${isExpanded ? 'Свернуть' : 'Открыть'} запись: ${item.title || category.title}`}
            accessibilityState={{ expanded: isExpanded }} onPress={() => toggle(item)} style={styles.card}>
            <Text style={styles.category}>{category.title}</Text>
            {!isExpanded ? <Text style={styles.title}>{item.title || category.title}</Text> : null}
            {!isExpanded && item.body ? <Text numberOfLines={3} style={styles.body}>{item.body}</Text> : null}
            {!isExpanded ? <Text style={styles.caption}>{[formatRuDate(item.event_date), captionFor(item)].filter(Boolean).join(' · ')}</Text> : null}
            <Text style={styles.open}>{isExpanded ? 'Свернуть' : item.media.length ? `Открыть событие · ${item.media.length} вложений` : 'Читать запись'}</Text>
          </Pressable>
          {isExpanded ? <MemoryCard memory={item} contextLabel={captionFor(item)} onOpenMedia={open}
            onEdit={canEditMemory?.(item) ? () => {
              if (alive.current && focusedRef.current && foreground.current && latest.current.includes(item)) onEditMemory?.(item);
            } : undefined} /> : null}
        </View>;
      }} />
    {viewer}
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1 }, row: { marginBottom: 12 }, card: { padding: 18, backgroundColor: colors.surface, borderRadius: 22 },
  category: { color: colors.primary, fontSize: 11, fontWeight: '700', marginBottom: 8 },
  title: { color: colors.ink, fontSize: 18, fontWeight: '700', lineHeight: 25 },
  body: { color: colors.ink, fontSize: 14, lineHeight: 22, marginTop: 8 },
  caption: { color: colors.secondary, fontSize: 11, lineHeight: 17, marginTop: 10 },
  open: { color: colors.primary, fontSize: 12, fontWeight: '600', marginTop: 12 },
});
