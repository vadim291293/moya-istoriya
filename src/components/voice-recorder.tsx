import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, type VoiceAsset } from '../lib/memory-asset';
import { createVoiceCapture, type VoicePhase } from '../lib/voice-capture';
import { colors } from '../lib/theme';
import { StoryIcon } from './story-ui';
import { AudioPlayback, audioTime } from './audio-playback';

export function VoiceRecorder({ asset, disabled, canAdd, onChange, onBusyChange }: {
  asset?: VoiceAsset; disabled: boolean; canAdd: boolean;
  onChange: (asset: VoiceAsset | null) => void; onBusyChange: (busy: boolean) => void;
}) {
  const focused = useIsFocused();
  const alive = useRef(true), focus = useRef(focused), foreground = useRef(!AppState.currentState || AppState.currentState === 'active');
  focus.current = focused;
  const props = useRef({ disabled, canAdd, onChange, onBusyChange }); props.current = { disabled, canAdd, onChange, onBusyChange };
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<ReturnType<typeof createVoiceCapture> | null>(null);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000 }, event => {
    if (event.hasError) { controller.current?.cancel(); if (alive.current) setError('Запись прервалась. Попробуйте ещё раз.'); }
    else if (event.isFinished && !recorder.getStatus().isRecording) void controller.current?.stop(true, true, event.url);
  });
  const recorderState = useAudioRecorderState(recorder, 250);
  const capture = useMemo(() => createVoiceCapture({
    active: () => alive.current && focus.current && foreground.current,
    canPublish: () => alive.current && focus.current,
    permission: async () => (await AudioModule.requestRecordingPermissionsAsync()).granted,
    mode: recording => setAudioModeAsync({ allowsRecording: recording, allowsBackgroundRecording: false,
      shouldPlayInBackground: false, playsInSilentMode: true, interruptionMode: 'doNotMix' }),
    prepare: () => recorder.prepareToRecordAsync(), record: () => recorder.record({ forDuration: MAX_VOICE_SECONDS }),
    stop: () => recorder.stop(), uri: () => recorder.uri,
    asset: async uri => {
      // Native-only recording in v1: the private source stays in app cache until
      // upload. Never copy it into the user's public photo/media library.
      const fileSize = new File(uri).size;
      if (fileSize < 1 || fileSize > MAX_VOICE_BYTES) throw new Error('Invalid voice size');
      return { uri, type: 'audio', width: 0, height: 0, fileName: 'voice.m4a', mimeType: 'audio/mp4', fileSize };
    },
    phase: next => { setPhase(next); props.current.onBusyChange(next !== 'idle'); },
    error: setError, accept: voice => props.current.onChange(voice),
  }), [recorder]);
  controller.current = capture;
  useEffect(() => {
    alive.current = true;
    const app = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (!foreground.current) {
        if (capture.phase === 'starting') capture.cancel();
        else void capture.stop();
      }
    });
    return () => { alive.current = false; app.remove(); capture.cancel(); };
  }, [capture]);
  useEffect(() => {
    if (!focused) capture.cancel();
    else { setPhase(capture.phase); props.current.onBusyChange(capture.phase !== 'idle'); }
  }, [focused, capture]);
  useEffect(() => {
    if (phase === 'recording' && recorderState.durationMillis >= MAX_VOICE_SECONDS * 1000) void capture.stop();
  }, [phase, recorderState.durationMillis, capture]);
  return <View style={styles.wrap}>
    <Text style={styles.title}>Голос на память · необязательно</Text>
    <Text style={styles.hint}>Первое «мама», смешная фраза или рассказ близкого. До 3 минут, только для семьи.</Text>
    {asset && phase === 'idle' ? <>
      <AudioPlayback key={asset.uri} uri={asset.uri} />
      <Pressable accessibilityRole="button" accessibilityLabel="Убрать голосовую запись" disabled={disabled}
        onPress={() => { if (!props.current.disabled && alive.current && focus.current) props.current.onChange(null); }} style={styles.remove}>
        <Text style={styles.hint}>Убрать запись и записать заново</Text>
      </Pressable>
    </> : <Pressable accessibilityRole="button"
      accessibilityLabel={phase === 'recording' ? 'Остановить запись голоса' : 'Записать голос'}
      disabled={phase === 'starting' || phase === 'stopping' || (phase === 'idle' && (disabled || !canAdd || Platform.OS === 'web'))}
      onPress={() => {
        if (phase === 'recording') { void capture.stop(); return; }
        if (props.current.disabled || !props.current.canAdd || Platform.OS === 'web') return;
        setError(null); void capture.start();
      }} style={[styles.record, phase === 'recording' && styles.recording]}>
      <StoryIcon name={phase === 'recording' ? 'stop' : 'microphone'} color={colors.primary} size={24} />
      <Text style={styles.recordText}>{phase === 'recording' ? `Остановить · ${audioTime(recorderState.durationMillis / 1000)}`
        : phase === 'starting' ? 'Включаем микрофон…' : phase === 'stopping' ? 'Готовим запись…' : 'Записать голос'}</Text>
    </Pressable>}
    {Platform.OS === 'web' ? <Text style={styles.hint}>Записать голос можно в приложении на телефоне.</Text> : null}
    {!canAdd && !asset ? <Text style={styles.hint}>Уберите один файл: к записи можно добавить всего пять вложений.</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  wrap: { marginTop: 24, gap: 10 }, title: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  hint: { color: colors.secondary, fontSize: 13, lineHeight: 19 }, record: { flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, minHeight: 60, borderRadius: 18, backgroundColor: colors.primarySoft }, recording: { borderWidth: 1, borderColor: colors.primary },
  recordText: { color: colors.primary, fontSize: 16, fontWeight: '700', flex: 1 }, remove: { minHeight: 44, justifyContent: 'center' },
});
