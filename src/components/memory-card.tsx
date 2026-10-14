import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import type { FamilyMemory, MemoryMedia } from '../lib/memory-service';
import { formatRuDate } from '../lib/date-utils';
import { PhotoViewer } from './photo-viewer';
import { VideoViewer } from './video-viewer';
import { AudioViewer } from './audio-viewer';
import { colors } from '../lib/theme';
import { StoryIcon } from './story-ui';

function VideoPreview({ media, ageCaption, width, onPress }: {
  media: MemoryMedia; ageCaption?: string; width: number; onPress: () => void;
}) {
  if (!media.signed_url) return <UnavailableMedia width={width} />;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Воспроизвести видео"
      onPress={onPress}
      style={({ pressed }) => [styles.videoPreview, { width }, pressed && styles.pressed]}
    >
      <View style={styles.videoPlay}><StoryIcon name="play" color={colors.primary} size={26} /></View>
      <View style={styles.videoInfo}>
        <Text style={styles.videoLabel}>Смотреть видео</Text>
        <Text style={styles.videoAge}>{ageCaption || 'Открывается на весь экран'}</Text>
      </View>
    </Pressable>
  );
}

export function Photo({ media, ageCaption, width, onPress }: {
  media: MemoryMedia; ageCaption?: string; width: number; onPress: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const source = useRef(media.signed_url); source.current = media.signed_url;
  const displayedSource = media.signed_url;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setFailed(false); }, [media.signed_url]);
  if (!media.signed_url || failed) return <UnavailableMedia width={width} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Открыть фотографию на весь экран"
      onPress={() => { if (mounted.current && source.current === displayedSource) onPress(); }}
      style={({ pressed }) => [styles.photoFrame, { width, height: width * 1.05 }, pressed && styles.pressed]}>
      <Image
        accessibilityLabel="Фотография из семейной истории"
        onError={() => { if (mounted.current && source.current === displayedSource) setFailed(true); }}
        resizeMode="contain"
        source={{ uri: media.signed_url }}
        style={styles.photo}
      />
    </Pressable>
  );
}

function UnavailableMedia({ width }: { width: number }) {
  return <View style={[styles.photoFrame, { width }]}>
    <Text style={styles.context}>Файл временно недоступен.</Text>
    <Text style={styles.context}>Потяните список вниз, чтобы обновить доступ.</Text>
  </View>;
}

export function MemoryCard({
  memory,
  ageCaption,
  contextLabel,
  onOpenMedia,
  onEdit,
}: {
  memory: FamilyMemory;
  ageCaption?: string;
  contextLabel?: string;
  onOpenMedia?: (memory: FamilyMemory, media: MemoryMedia) => void;
  onEdit?: () => void;
}) {
  const isFocused = useIsFocused();
  const focused = useRef(isFocused);
  focused.current = isFocused;
  const mounted = useRef(true);
  const currentMemory = useRef(memory); currentMemory.current = memory;
  const foreground = useRef(!AppState.currentState || AppState.currentState === 'active');
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [mediaWidth, setMediaWidth] = useState(280);
  const closeViewer = useCallback(() => setViewerId(null), []);
  const closeVideo = useCallback(() => setVideoId(null), []);
  useEffect(() => {
    mounted.current = true;
    // Virtualized collections own the viewer and foreground listener. A cell
    // still guards its lifetime, but does not start a player or own a modal.
    if (onOpenMedia) return () => { mounted.current = false; };
    const subscription = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (!foreground.current) { setViewerId(null); setVideoId(null); }
    });
    return () => { mounted.current = false; subscription.remove(); };
  }, [onOpenMedia]);
  useEffect(() => { if (!isFocused) { setViewerId(null); setVideoId(null); } }, [isFocused]);
  function canOpen() { return mounted.current && currentMemory.current === memory && focused.current && (Boolean(onOpenMedia) || foreground.current); }
  function openMedia(media: MemoryMedia) {
    if (!canOpen()) return;
    if (onOpenMedia) { onOpenMedia(memory, media); return; }
    if (media.media_type === 'image') { setVideoId(null); setViewerId(media.id); }
    else { setViewerId(null); setVideoId(media.id); }
  }
  const photos = memory.media.filter((media) => media.media_type === 'image');
  const video = memory.media.find((media) => media.media_type === 'video' && media.id === videoId);
  const audio = memory.media.find((media) => media.media_type === 'audio' && media.id === videoId);
  const defaultTitle = memory.media.length > 0
    ? memory.media.some((media) => media.media_type === 'video')
      ? 'Воспоминание с видео'
      : memory.media.some(media => media.media_type === 'image') ? 'Фотография из истории' : 'Голос на память'
    : 'Воспоминание';

  return (
    <View style={styles.card} onLayout={(event) => {
      if (mounted.current && currentMemory.current === memory) setMediaWidth(Math.max(100, event.nativeEvent.layout.width - 26));
    }}>
      {memory.media.length > 0 ? (
        <ScrollView
          horizontal
          contentContainerStyle={styles.mediaList}
          showsHorizontalScrollIndicator={false}
        >
          {memory.media.map((media) => (
            <View key={media.id} style={styles.mediaItem}>
              {media.media_type === 'image' ? (
                <Photo media={media} ageCaption={ageCaption}
                  width={memory.media.length > 1 ? Math.min(320, mediaWidth * 0.88) : mediaWidth}
                  onPress={() => openMedia(media)} />
              ) : media.media_type === 'audio' ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Открыть голосовую запись"
                  onPress={() => openMedia(media)} style={[styles.videoPreview, { width: Math.min(320, mediaWidth) }]}>
                  <View style={styles.videoPlay}><StoryIcon name="microphone" color={colors.primary} size={26} /></View>
                  <View style={styles.videoInfo}><Text style={styles.videoLabel}>Голос на память</Text>
                    <Text style={styles.videoAge}>Нажмите, чтобы послушать</Text></View>
                </Pressable>
              ) : (
                <VideoPreview media={media} ageCaption={ageCaption}
                  onPress={() => openMedia(media)}
                  width={memory.media.length > 1 ? Math.min(320, mediaWidth * 0.88) : mediaWidth} />
              )}
            </View>
          ))}
        </ScrollView>
      ) : null}
      {ageCaption || contextLabel ? (
        <Text style={styles.ageHeading}>{ageCaption ?? contextLabel}</Text>
      ) : null}
      <View style={styles.metaRow}>
        <Text style={styles.date}>{formatRuDate(memory.event_date)}</Text>
        {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Изменить воспоминание"
          style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }} onPress={() => { if (canOpen()) onEdit(); }}>
          <Text style={styles.date}>Изменить</Text>
        </Pressable> : null}
      </View>
      <Text style={styles.title}>{memory.title?.trim() || defaultTitle}</Text>
      {memory.body ? <Text style={styles.body}>{memory.body}</Text> : null}

      {!onOpenMedia && viewerId && isFocused && photos.length > 0 ? <PhotoViewer photos={photos} initialId={viewerId}
        title={memory.title?.trim() || defaultTitle}
        caption={[formatRuDate(memory.event_date), ageCaption ?? contextLabel].filter(Boolean).join(' · ')} onClose={closeViewer} /> : null}
      {!onOpenMedia && video && isFocused ? <VideoViewer key={`${video.id}:${video.signed_url}`} media={video}
        title={memory.title?.trim() || defaultTitle}
        caption={[formatRuDate(memory.event_date), ageCaption ?? contextLabel].filter(Boolean).join(' · ')} onClose={closeVideo} /> : null}
      {!onOpenMedia && audio && isFocused ? <AudioViewer key={`${audio.id}:${audio.signed_url}`} media={audio}
        title={memory.title?.trim() || 'Голос на память'}
        caption={[formatRuDate(memory.event_date), ageCaption ?? contextLabel].filter(Boolean).join(' · ')} onClose={closeVideo} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 26,
    borderWidth: 0,
    padding: 12,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  date: {
    color: colors.secondary,
    fontSize: 12,
    fontWeight: '700',
  },
  ageHeading: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  context: {
    color: colors.muted,
    flex: 1,
    fontSize: 11,
    textAlign: 'right',
  },
  title: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
    marginTop: 8,
  },
  body: {
    color: colors.secondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  mediaList: {
    gap: 10,
    paddingBottom: 14,
  },
  mediaItem: {
    overflow: 'hidden',
    borderRadius: 15,
  },
  photoFrame: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 15,
    height: 250,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 290,
  },
  photo: {
    height: '100%',
    width: '100%',
  },
  agePill: {
    backgroundColor: 'rgba(40, 29, 66, 0.72)',
    borderRadius: 14,
    bottom: 10,
    left: 10,
    maxWidth: '80%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: 'absolute',
  },
  agePillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  openPill: {
    backgroundColor: 'rgba(16, 27, 32, 0.65)',
    borderRadius: 14,
    bottom: 10,
    right: 10,
    height: 32,
    width: 32,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
  },
  openPillText: { color: '#FFFFFF', fontSize: 23, lineHeight: 28 },
  videoPreview: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 15,
    minHeight: 90,
    flexDirection: 'row',
    padding: 14,
    gap: 12,
    width: 290,
  },
  videoPlay: { width: 48, height: 48, backgroundColor: colors.surface, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  videoInfo: { flex: 1 },
  videoLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  videoAge: {
    color: colors.secondary,
    fontSize: 12,
    marginTop: 5,
  },
  pressed: {
    opacity: 0.8,
  },
});
