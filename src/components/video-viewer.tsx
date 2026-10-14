import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MemoryMedia } from '../lib/memory-service';
import { StoryIcon } from './story-ui';

function timeLabel(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function VideoViewer({ media, title, caption, onClose, onEdit }: {
  media: MemoryMedia; title: string; caption: string; onClose: () => void;
  onEdit?: () => void;
}) {
  const isFocused = useIsFocused();
  const focused = useRef(isFocused);
  focused.current = isFocused;
  const foreground = useRef(!AppState.currentState || AppState.currentState === 'active');
  const alive = useRef(true);
  const closing = useRef(false);
  const started = useRef(false);
  const closeCallback = useRef(onClose);
  const editCallback = useRef(onEdit); editCallback.current = onEdit;
  closeCallback.current = onClose;
  const [playFailed, setPlayFailed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [seekPosition, setSeekPosition] = useState<number | null>(null);
  const trackWidth = useRef(1);
  // No private video is preloaded by its feed card or persisted in a video cache.
  // The hook releases the native player when this viewer unmounts.
  const player = useVideoPlayer(media.signed_url ? { uri: media.signed_url, useCaching: false } : null, (instance) => {
    instance.staysActiveInBackground = false;
    instance.showNowPlayingNotification = false;
    instance.timeUpdateEventInterval = 0.25;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: player.currentTime,
    currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: player.bufferedPosition });
  const { duration: sourceDuration } = useEvent(player, 'sourceLoad', { duration: player.duration,
    videoSource: null, availableVideoTracks: [], availableSubtitleTracks: [], availableAudioTracks: [] });
  const playing = Boolean(isPlaying);
  const duration = Number.isFinite(sourceDuration) ? Math.max(0, sourceDuration) : 0;
  const position = Math.min(duration, Math.max(0, seekPosition ?? (Number.isFinite(currentTime) ? currentTime : 0)));
  const pause = useCallback(() => {
    try { player.pause(); } catch { /* The hook may already have released it. */ }
  }, [player]);
  const close = useCallback(() => {
    if (!alive.current || closing.current) return;
    closing.current = true;
    pause();
    closeCallback.current();
  }, [pause]);

  useEffect(() => {
    alive.current = true;
    started.current = false;
    const appSubscription = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (!foreground.current) close();
    });
    // A late native-control event must not restart a closed/background player.
    const playbackSubscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying && (!alive.current || closing.current || !focused.current || !foreground.current)) pause();
    });
    if (!foreground.current || !focused.current) close();
    return () => {
      alive.current = false;
      appSubscription.remove();
      playbackSubscription.remove();
      pause();
    };
  }, [player, close, pause]);
  useEffect(() => { if (!isFocused) close(); }, [isFocused, close]);
  useEffect(() => { setSeekPosition(null); }, [currentTime]);
  useEffect(() => {
    if (!playing || status !== 'readyToPlay' || !controlsVisible) return;
    const timer = setTimeout(() => { if (alive.current && !closing.current) setControlsVisible(false); }, 3000);
    return () => clearTimeout(timer);
  }, [playing, status, controlsVisible, seekPosition]);
  useEffect(() => {
    if (status === 'error' || playFailed) { pause(); return; }
    if (status !== 'readyToPlay' || !media.signed_url || started.current
      || !alive.current || closing.current || !focused.current || !foreground.current) return;
    started.current = true;
    // The user already tapped "play" on the card. Buffering or a subsequent
    // status change must not undo a manual pause by starting again.
    try { player.play(); } catch { setPlayFailed(true); }
  }, [status, player, media.signed_url, isFocused, playFailed, pause]);

  const unavailable = !media.signed_url || status === 'error' || playFailed;
  const canInteract = () => alive.current && !closing.current && focused.current && foreground.current && !unavailable;
  function togglePlayback() {
    if (!canInteract() || status !== 'readyToPlay') return;
    setControlsVisible(true);
    try {
      if (player.playing) pause();
      else { if (duration > 0 && player.currentTime >= duration - 0.1) player.currentTime = 0; player.play(); }
    } catch { setPlayFailed(true); }
  }
  function seek(seconds: number) {
    if (!canInteract() || duration <= 0 || !Number.isFinite(seconds)) return;
    const next = Math.max(0, Math.min(duration, seconds));
    try { player.currentTime = next; setSeekPosition(next); setControlsVisible(true); } catch { /* Closing/released player. */ }
  }
  const showControls = controlsVisible || !playing || unavailable;
  return <Modal animationType="fade" presentationStyle="fullScreen" visible
    supportedOrientations={['portrait', 'landscape']} onRequestClose={close}>
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text numberOfLines={2} style={styles.title}>{title}</Text>
          <Text style={styles.caption}>{caption}</Text>
        </View>
        {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Изменить воспоминание" style={styles.close} onPress={() => {
          if (!alive.current || closing.current || !focused.current || !foreground.current) return;
          pause(); editCallback.current?.();
        }}><StoryIcon name="note" color="#FFFFFF" size={20} /></Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть видео" onPress={close} style={styles.close}>
          <StoryIcon name="close" color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={styles.stage}>
        {unavailable ? <View style={styles.unavailable}>
          <Text accessibilityLiveRegion="polite" style={styles.title}>Не удалось открыть видео</Text>
          <Text style={styles.errorText}>Закройте просмотр и потяните галерею вниз, чтобы обновить доступ.</Text>
        </View> : <>
          <VideoView accessibilityLabel="Видео воспоминания" player={player} style={styles.video}
            contentFit="contain" nativeControls={false} playsInline fullscreenOptions={{ enable: false }}
            allowsPictureInPicture={false} startsPictureInPictureAutomatically={false} />
          <Pressable accessibilityRole="button" accessibilityLabel="Показать или скрыть управление видео" style={styles.tapSurface}
            onPress={() => { if (canInteract()) setControlsVisible((visible) => !visible); }} />
          {status === 'idle' || status === 'loading' ? <View pointerEvents="none" style={styles.loading}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text accessibilityLiveRegion="polite" style={styles.loadingText}>Открываем видео…</Text>
          </View> : null}
        </>}
      </View>
      {!unavailable ? <View style={[styles.controls, !showControls && styles.hiddenControls]} pointerEvents={showControls ? 'auto' : 'none'}
        accessibilityElementsHidden={!showControls} importantForAccessibility={showControls ? 'auto' : 'no-hide-descendants'}>
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Приостановить видео' : 'Продолжить видео'}
          disabled={status !== 'readyToPlay'} onPress={togglePlayback} style={styles.close}>
          <StoryIcon name={playing ? 'pause' : 'play'} color="#FFFFFF" size={22} />
        </Pressable>
        <View style={styles.timeline}>
          <View accessibilityRole="adjustable" accessibilityLabel="Позиция видео"
            accessibilityValue={{ min: 0, max: duration, now: position, text: `${timeLabel(position)} из ${timeLabel(duration)}` }}
            accessibilityActions={[{ name: 'increment', label: 'Вперёд на 10 секунд' }, { name: 'decrement', label: 'Назад на 10 секунд' }]}
            onAccessibilityAction={(event) => seek(position + (event.nativeEvent.actionName === 'increment' ? 10 : -10))}
            onLayout={(event) => { trackWidth.current = Math.max(1, event.nativeEvent.layout.width); }}
            onStartShouldSetResponder={() => canInteract() && duration > 0}
            onResponderGrant={(event) => seek(event.nativeEvent.locationX / trackWidth.current * duration)}
            onResponderMove={(event) => seek(event.nativeEvent.locationX / trackWidth.current * duration)} style={styles.trackTouch}>
            <View pointerEvents="none" style={styles.track}><View style={[styles.progress, { width: `${duration > 0 ? position / duration * 100 : 0}%` }]} /></View>
          </View>
          <View style={styles.times}><Text style={styles.time}>{timeLabel(position)}</Text><Text style={styles.time}>{timeLabel(duration)}</Text></View>
        </View>
      </View> : null}
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#191720' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  heading: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', lineHeight: 24 },
  caption: { color: '#CBC5D2', fontSize: 12, lineHeight: 18, marginTop: 4 },
  close: { minWidth: 44, minHeight: 44, borderRadius: 16, backgroundColor: '#302C3B', alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, minHeight: 80, justifyContent: 'center' },
  video: { flex: 1, width: '100%', backgroundColor: '#191720' },
  tapSurface: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  loading: { position: 'absolute', alignItems: 'center', alignSelf: 'center', gap: 12 },
  loadingText: { color: '#FFFFFF', fontSize: 13 },
  unavailable: { padding: 24, alignItems: 'center' },
  errorText: { color: '#CBC5D2', textAlign: 'center', fontSize: 14, lineHeight: 22, marginTop: 10 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingBottom: 12, minHeight: 70 },
  hiddenControls: { opacity: 0 }, timeline: { flex: 1 }, trackTouch: { height: 44, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: '#625A72', overflow: 'hidden' },
  progress: { height: 4, backgroundColor: '#FFFFFF' }, times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: '#CBC5D2', fontSize: 11 },
});
