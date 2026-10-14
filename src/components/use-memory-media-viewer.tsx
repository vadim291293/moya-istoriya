import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { AppState } from 'react-native';
import type { FamilyMemory, MemoryMedia } from '../lib/memory-service';
import { formatRuDate } from '../lib/date-utils';
import { PhotoViewer } from './photo-viewer';
import { VideoViewer } from './video-viewer';
import { AudioViewer } from './audio-viewer';

function titleFor(memory: FamilyMemory, media: MemoryMedia, mode: 'album' | 'memory') {
  if (memory.title?.trim()) return memory.title.trim();
  if (media.media_type === 'audio') return 'Голос на память';
  if (mode === 'album') return media.media_type === 'video' ? 'Семейное видео' : 'Семейный момент';
  return memory.media.some((item) => item.media_type === 'video') ? 'Воспоминание с видео' : 'Фотография из истории';
}

// The collection owns this state, never a recycled list cell. Keep only IDs in
// selection and always resolve the latest row/signed URL from the current data.
export type MemoryEditingActions = {
  onEditMemory?: (memory: FamilyMemory) => void;
  canEditMemory?: (memory: FamilyMemory) => boolean;
};
export function useMemoryMediaViewer(memories: FamilyMemory[], captionFor: (memory: FamilyMemory) => string | undefined,
  mode: 'album' | 'memory' = 'album', actions: MemoryEditingActions = {}) {
  const focused = useIsFocused();
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const mounted = useRef(true);
  const foreground = useRef(!AppState.currentState || AppState.currentState === 'active');
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const items = useMemo(() => memories.flatMap((memory) => memory.media.map((media) => ({
    key: `${memory.id}:${media.id}`, memory, media,
  }))), [memories]);
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const latest = useRef(byKey); latest.current = byKey;
  const latestActions = useRef(actions); latestActions.current = actions;
  const current = selected ? byKey.get(selected) : undefined;
  const close = useCallback(() => {
    if (mounted.current && selectedRef.current === selected) { selectedRef.current = null; setSelected(null); }
  }, [selected]);
  const open = useCallback((memory: FamilyMemory, media: MemoryMedia) => {
    const key = `${memory.id}:${media.id}`;
    const item = latest.current.get(key);
    if (mounted.current && focusedRef.current && foreground.current && item?.memory === memory && item.media === media) {
      selectedRef.current = key; setSelected(key);
    }
  }, []);
  const edit = useCallback((memoryId: string) => {
    if (!mounted.current || !focusedRef.current || !foreground.current || !selected
      || selectedRef.current !== selected || !latest.current.has(selected)) return;
    const memory = Array.from(latest.current.values()).find((item) => item.memory.id === memoryId)?.memory;
    const action = latestActions.current;
    if (!memory || !action.onEditMemory || !action.canEditMemory?.(memory)) return;
    selectedRef.current = null; setSelected(null);
    action.onEditMemory(memory);
  }, [selected]);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', (state) => {
      if (!mounted.current) return;
      foreground.current = state === 'active';
      if (!foreground.current) { selectedRef.current = null; setSelected(null); }
    });
    return () => { mounted.current = false; selectedRef.current = null; listener.remove(); };
  }, []);
  useEffect(() => {
    if (!focused || (selected && !current)) { selectedRef.current = null; setSelected(null); }
  }, [current, focused, selected]);
  const photos = useMemo(() => (mode === 'memory' ? items.filter((item) => item.memory === current?.memory) : items)
    .filter((item) => item.media.media_type === 'image').map((item) => ({ ...item.media,
      viewerTitle: titleFor(item.memory, item.media, mode),
      viewerCaption: [formatRuDate(item.memory.event_date), captionFor(item.memory)].filter(Boolean).join(' · '),
      viewerMemoryId: item.memory.id,
      viewerCanEdit: Boolean(actions.onEditMemory && actions.canEditMemory?.(item.memory)),
    })), [actions.onEditMemory, actions.canEditMemory, captionFor, current?.memory, items, mode]);
  const viewer = focused && current ? current.media.media_type === 'image'
    ? <PhotoViewer key={current.key} photos={photos} initialId={current.media.id}
      title={titleFor(current.memory, current.media, mode)}
      caption={[formatRuDate(current.memory.event_date), captionFor(current.memory)].filter(Boolean).join(' · ')} onClose={close} onEdit={edit} />
    : current.media.media_type === 'audio' ? <AudioViewer key={`${current.key}:${current.media.signed_url}`} media={current.media}
      title={titleFor(current.memory, current.media, mode)}
      caption={[formatRuDate(current.memory.event_date), captionFor(current.memory)].filter(Boolean).join(' · ')} onClose={close}
      onEdit={actions.onEditMemory && actions.canEditMemory?.(current.memory) ? () => edit(current.memory.id) : undefined} />
    : <VideoViewer key={`${current.key}:${current.media.signed_url}`} media={current.media}
      title={titleFor(current.memory, current.media, mode)}
      caption={[formatRuDate(current.memory.event_date), captionFor(current.memory)].filter(Boolean).join(' · ')} onClose={close}
      onEdit={actions.onEditMemory && actions.canEditMemory?.(current.memory) ? () => edit(current.memory.id) : undefined} />
    : null;
  return { open, viewer };
}
