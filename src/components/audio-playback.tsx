import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { colors } from '../lib/theme';
import { StoryIcon } from './story-ui';

export function audioTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

// Mounted only for a selected voice/draft, not for each virtualized diary row.
export type AudioPlaybackLifetime = { enabled: boolean; pause?: () => void };
export function AudioPlayback({ uri, lifetime }: { uri: string; lifetime?: AudioPlaybackLifetime }) {
  const focused = useIsFocused();
  const alive = useRef(true), foreground = useRef(!AppState.currentState || AppState.currentState === 'active');
  const focus = useRef(focused); focus.current = focused;
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const permission = () => alive.current && focus.current && foreground.current && (!lifetime || lifetime.enabled);
  const player = useAudioPlayer({ uri }, { downloadFirst: false, updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  function pause() { try { player.pause(); } catch { /* Released by the hook. */ } }
  useEffect(() => {
    alive.current = true;
    if (lifetime) lifetime.pause = pause;
    const app = AppState.addEventListener('change', state => {
      foreground.current = state === 'active'; if (!foreground.current) pause();
    });
    const playback = player.addListener('playbackStatusUpdate', event => {
      if (event.playing && !permission()) pause();
    });
    return () => { alive.current = false; app.remove(); playback.remove(); pause(); if (lifetime?.pause === pause) lifetime.pause = undefined; };
  }, [player]);
  useEffect(() => { if (!focused) pause(); }, [focused, player]);
  async function toggle() {
    if (!permission() || busy.current) return;
    if (player.playing) { pause(); return; }
    busy.current = true; setFailed(false);
    try {
      await setAudioModeAsync({ allowsRecording: false, shouldPlayInBackground: false, allowsBackgroundRecording: false,
        playsInSilentMode: true, interruptionMode: 'doNotMix' });
      if (!permission()) return;
      if (status.didJustFinish || (player.duration > 0 && player.currentTime >= player.duration - 0.1)) await player.seekTo(0);
      if (permission()) player.play();
    } catch { if (alive.current) setFailed(true); }
    finally { busy.current = false; }
  }
  return <View style={styles.wrap}>
    <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Приостановить голос' : 'Прослушать голос'}
      onPress={() => void toggle()} style={styles.button}>
      <StoryIcon name={status.playing ? 'pause' : 'play'} color={colors.primary} size={26} />
      <View style={styles.info}><Text style={styles.title}>{status.playing ? 'Слушаем голос' : 'Прослушать голос'}</Text>
        <Text style={styles.caption}>{audioTime(status.currentTime)} / {audioTime(status.duration)}</Text></View>
    </Pressable>
    {status.isBuffering ? <Text style={styles.caption}>Загружаем звук…</Text> : null}
    {failed || status.error ? <Text accessibilityLiveRegion="polite" style={styles.caption}>Не удалось воспроизвести. Проверьте соединение и повторите.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  wrap: { gap: 6 }, button: { minHeight: 64, padding: 14, gap: 14, flexDirection: 'row', alignItems: 'center', borderRadius: 18, backgroundColor: colors.primarySoft },
  info: { flex: 1 }, title: { color: colors.ink, fontSize: 16, fontWeight: '700' }, caption: { color: colors.secondary, fontSize: 13, marginTop: 4 },
});
