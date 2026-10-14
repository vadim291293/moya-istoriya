import { useEffect, useRef } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AudioPlayback, type AudioPlaybackLifetime } from './audio-playback';
import { StoryIcon } from './story-ui';
import { colors } from '../lib/theme';
import type { MemoryMedia } from '../lib/memory-service';

export function AudioViewer({ media, title, caption, onClose, onEdit }: {
  media: MemoryMedia; title: string; caption?: string; onClose: () => void; onEdit?: () => void;
}) {
  const focused = useIsFocused();
  const alive = useRef(true), focus = useRef(focused), foreground = useRef(!AppState.currentState || AppState.currentState === 'active');
  focus.current = focused;
  const callbacks = useRef({ onClose, onEdit }); callbacks.current = { onClose, onEdit };
  const closing = useRef(false);
  const lifetime = useRef<AudioPlaybackLifetime>({ enabled: true });
  function deactivate() { lifetime.current.enabled = false; lifetime.current.pause?.(); }
  function close() { if (alive.current && !closing.current) { closing.current = true; deactivate(); callbacks.current.onClose(); } }
  useEffect(() => {
    alive.current = true;
    // React development mode may run setup/cleanup/setup without unmounting
    // the refs. Re-enable this still-open viewer, never an already closed one.
    lifetime.current.enabled = !closing.current && focus.current && foreground.current;
    const app = AppState.addEventListener('change', state => { foreground.current = state === 'active'; if (!foreground.current) close(); });
    return () => { alive.current = false; deactivate(); app.remove(); };
  }, []);
  useEffect(() => { if (!focused) close(); }, [focused]);
  return <Modal visible={focused} animationType="fade" onRequestClose={close}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Text style={styles.heading}>Голос на память</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть голосовую запись" onPress={close} style={styles.icon}><StoryIcon name="close" /></Pressable></View>
      <View style={styles.content}>
        <StoryIcon name="microphone" color={colors.primary} size={54} />
        <Text style={styles.title}>{title}</Text><Text style={styles.caption}>{caption}</Text>
        {media.signed_url ? <AudioPlayback key={media.signed_url} uri={media.signed_url} lifetime={lifetime.current} />
          : <Text style={styles.caption}>Запись временно недоступна. Обновите дневник.</Text>}
        {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Изменить воспоминание с голосом" style={styles.icon}
          onPress={() => { if (alive.current && focus.current && foreground.current && !closing.current) { closing.current = true; deactivate(); callbacks.current.onEdit?.(); } }}>
          <Text style={styles.caption}>Изменить заметку</Text></Pressable> : null}
      </View>
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, header: { padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 18, fontWeight: '700', color: colors.ink }, icon: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, justifyContent: 'center', padding: 24, gap: 20 }, title: { fontSize: 26, fontWeight: '700', color: colors.ink },
  caption: { fontSize: 14, lineHeight: 21, color: colors.secondary },
});
