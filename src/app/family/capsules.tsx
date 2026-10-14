import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import * as ImagePicker from 'expo-image-picker';
import { FamilyFormScreen, FormButton, familyFormStyles as ui } from '../../components/family-form-ui';
import { useFamilyFormScope } from '../../components/use-family-form-scope';
import { StoryIcon } from '../../components/story-ui';
import { PhotoViewer } from '../../components/photo-viewer';
import { VideoViewer } from '../../components/video-viewer';
import { AudioViewer } from '../../components/audio-viewer';
import { VoiceRecorder } from '../../components/voice-recorder';
import type { MemoryAsset, VoiceAsset } from '../../lib/memory-asset';
import type { MemoryMedia } from '../../lib/memory-service';
import { colors } from '../../lib/theme';
import { randomUUID } from 'expo-crypto';
import { decryptCapsuleBytes } from '../../lib/capsule-crypto';
import { capsuleTemporaryFile, type CapsuleTemp } from '../../lib/capsule-temp';
import { getCapsuleBiometry, enableCapsuleBiometry, readCapsuleBiometry, disableCapsuleBiometry, type CapsuleBioStatus } from '../../lib/capsule-biometry';
import { CapsuleError, capsuleConfigured, setupCapsuleVault, unlockCapsuleVault, lockCapsuleVault, getCapsulePage, capsuleKey,
  getCapsule, uploadCapsuleFile, prepareCapsuleWrite, commitCapsuleWrite, archiveCapsuleWrite, downloadCapsuleFile, resetCapsulePassword,
  type Capsule, type CapsulePermit, type CapsuleFile, type CapsuleWrite, type CapsuleCursor } from '../../lib/capsule-service';

type Draft = { id: string; version: number; title: string; letter: string; childId: string | null; files: CapsuleFile[]; archived: boolean };
type Resume = { draft: Draft; assets: MemoryAsset[]; voice?: VoiceAsset; attempt?: CapsuleWrite | null };

export default function CapsulesScreen() {
  const router = useRouter(), navigation = useNavigation(); const form = useFamilyFormScope();
  const auth = form.auth; const owner = auth.family.status === 'ready' && auth.family.family.role === 'owner';
  const actor = auth.session?.user.id; const familyId = auth.family.status === 'ready' ? auth.family.family.id : null;
  const scope = { userId: actor ?? '', familyId: familyId ?? '' };
  const current = useRef({ form, owner, scope }); current.current = { form, owner, scope };
  const alive = useRef(true), foreground = useRef(!AppState.currentState || AppState.currentState === 'active');
  const permitRef = useRef<CapsulePermit | null>(null), keyRef = useRef<string | null>(null), busyRef = useRef(false);
  const picking = useRef(false), resume = useRef<Resume | null>(null), temp = useRef<CapsuleTemp | null>(null);
  const epoch = useRef(0);
  const renderEpoch = epoch.current;
  const biometricPrompt = useRef(false), activeWaiters = useRef(new Set<(active: boolean) => void>());
  const [configured, setConfigured] = useState<boolean | null>(null), [permit, setPermit] = useState<CapsulePermit | null>(null);
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [accountPassword, setAccountPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false), [showAccountPassword, setShowAccountPassword] = useState(false);
  const [bio, setBio] = useState<CapsuleBioStatus>({ available: false, enabled: false, label: 'Биометрия', reason: null });
  const [biometricWanted, setBiometricWanted] = useState(false), [passwordMode, setPasswordMode] = useState(false), [bioChecked, setBioChecked] = useState(false);
  const [recovery, setRecovery] = useState(false), [rows, setRows] = useState<Capsule[]>([]), [trash, setTrash] = useState(false);
  const [listState, setListState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [discard, setDiscard] = useState<'list' | 'back' | null>(null), [allowExit, setAllowExit] = useState(false);
  const exit = useRef<{ run: () => void; ticket: number } | null>(null);
  const trashRef = useRef(trash); trashRef.current = trash;
  const [cursor, setCursor] = useState<CapsuleCursor | null>(null), cursorRef = useRef(cursor); cursorRef.current = cursor;
  const [draft, setDraft] = useState<Draft | null>(null), draftRef = useRef<Draft | null>(null); draftRef.current = draft;
  const [voice, setVoice] = useState<VoiceAsset | undefined>(undefined), voiceBusy = useRef(false), [recording, setRecording] = useState(false);
  const voiceRef = useRef(voice); voiceRef.current = voice;
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<CapsuleWrite | null>(null), pendingRef = useRef<CapsuleWrite | null>(null); pendingRef.current = pending;
  const [confirmTrash, setConfirmTrash] = useState(false), [viewer, setViewer] = useState<MemoryMedia | null>(null);
  function base() { return alive.current && current.current.owner && current.current.form.live(); }
  function open(p = permitRef.current) { return base() && foreground.current && Boolean(p && permitRef.current === p && Date.parse(p.expiresAt) > Date.now()); }
  function disposeTemp() { temp.current?.dispose(); temp.current = null; }
  function lock(preserveDraft = false) {
    const old = permitRef.current; permitRef.current = null; keyRef.current = null; epoch.current++;
    disposeTemp(); voiceBusy.current = false;
    for (const finish of activeWaiters.current) finish(false);
    if (preserveDraft && old && draftRef.current && !picking.current)
      resume.current = { draft: { ...draftRef.current, files: [...draftRef.current.files] }, assets: [], voice: voiceRef.current, attempt: pendingRef.current };
    if (!preserveDraft) resume.current = null;
    if (alive.current) {
      setPermit(null); setDraft(null); setRows([]); setViewer(null); setVoice(undefined); setRecording(false);
      setCursor(null); cursorRef.current = null;
      setListState('idle'); setDiscard(null); setAllowExit(false); exit.current = null;
      setPassword(''); setConfirmation(''); setAccountPassword(''); setPending(null); setConfirmTrash(false); setNotice(null);
      setShowPassword(false); setShowAccountPassword(false); setBiometricWanted(false); setPasswordMode(false);
    }
    if (old) void lockCapsuleVault(current.current.scope, old).catch(() => {});
  }
  useEffect(() => {
    alive.current = true;
    const app = AppState.addEventListener('change', state => {
      if (!alive.current) return;
      foreground.current = state === 'active';
      if (state === 'active') { for (const finish of activeWaiters.current) finish(true); return; }
      setShowPassword(false); setShowAccountPassword(false);
      // An OS biometric dialog may cause iOS inactive. During that expected
      // dialog the vault is still CLOSED; a real background always invalidates.
      if (state === 'inactive' && biometricPrompt.current && !permitRef.current) return;
      lock(true);
    });
    return () => { alive.current = false; lock(); app.remove(); };
  }, []);
  useEffect(() => { if (!form.focused || !form.valid || !owner) lock(); }, [form.focused, form.valid, owner]);
  // Do not obstruct logout/account changes. Only in-scope navigation is guarded.
  usePreventRemove(form.valid && owner && !allowExit && Boolean(draft || resume.current || busy || recording || pending), event => {
    if (!base() || !foreground.current) return;
    if (busyRef.current || voiceBusy.current || pendingRef.current) { setError('Сначала дождитесь результата или проверьте сохранение на сервере.'); return; }
    exit.current = { run: () => navigation.dispatch(event.data.action), ticket: epoch.current }; setDiscard('back');
  });
  useEffect(() => {
    if (!allowExit || !exit.current) return;
    const next = exit.current;
    if (base() && foreground.current && next.ticket === epoch.current) { lock(); next.run(); }
  }, [allowExit]);
  useEffect(() => {
    if (!base()) return;
    let valid = true;
    capsuleConfigured(scope).then(value => { if (valid && base()) setConfigured(value); })
      .catch(e => { if (valid && base()) setError(e.message); });
    return () => { valid = false; };
  }, []);
  useEffect(() => {
    if (!base()) return;
    let valid = true;
    getCapsuleBiometry(scope).then(value => { if (valid && base()) { setBio(value); setBioChecked(true); } });
    return () => { valid = false; };
  }, []);
  useEffect(() => {
    if (!permit) return;
    const timer = setTimeout(() => lock(true), Math.max(0, Date.parse(permit.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [permit]);
  function update(change: Partial<Draft>) { if (open() && !busyRef.current && !voiceBusy.current && !pendingRef.current) setDraft(d => d ? { ...d, ...change } : null); }
  async function work(job: (ticket: number) => Promise<void>) {
    if (!base() || !foreground.current || renderEpoch !== epoch.current || busyRef.current || voiceBusy.current) return;
    busyRef.current = true; setBusy(true); setError(null); const ticket = epoch.current;
    try { await job(ticket); }
    catch (e) { if (base() && ticket === epoch.current) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.'); if (e instanceof CapsuleError && (e.kind === 'locked' || e.kind === 'scope')) lock(); } }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  function passwordLive() { return base() && foreground.current && renderEpoch === epoch.current && !busyRef.current; }
  function gateMode(manual: boolean, enroll = false) {
    if (!passwordLive()) return;
    epoch.current++; setPasswordMode(manual); setBiometricWanted(enroll);
    setShowPassword(false); setShowAccountPassword(false); setError(null);
    if (!enroll) { setPassword(''); setConfirmation(''); setAccountPassword(''); }
  }
  async function waitUntilActive(ticket: number) {
    if (!base() || ticket !== epoch.current) return false;
    if (foreground.current) return true;
    return new Promise<boolean>(resolve => {
      const finish = (active: boolean) => { clearTimeout(timer); activeWaiters.current.delete(finish); resolve(active && base() && ticket === epoch.current); };
      const timer = setTimeout(() => finish(false), 2500);
      activeWaiters.current.add(finish);
    });
  }
  async function refresh(p: CapsulePermit) {
    const archived = trashRef.current;
    if (!open(p)) return;
    setListState('loading');
    try {
      const page = await getCapsulePage(scope, p, archived);
      if (open(p) && trashRef.current === archived) { setRows(page.items); setCursor(page.nextCursor); cursorRef.current = page.nextCursor; setListState('ready'); }
    } catch (e) {
      if (open(p) && trashRef.current === archived) setListState('error');
      throw e;
    }
  }
  async function loadMore() {
    const p = permitRef.current, before = cursorRef.current, archived = trashRef.current;
    if (!p || !before || !open(p)) return;
    const page = await getCapsulePage(scope, p, archived, before);
    if (!open(p) || trashRef.current !== archived || cursorRef.current !== before) return;
    setRows(old => { const seen = new Set(old.map(row => row.id)); return [...old, ...page.items.filter(row => !seen.has(row.id))]; });
    setCursor(page.nextCursor); cursorRef.current = page.nextCursor;
  }
  async function changeList(archived: boolean) {
    const p = permitRef.current; if (!p || !open(p)) return;
    trashRef.current = archived; setTrash(archived); setRows([]); setCursor(null); cursorRef.current = null;
    await refresh(p);
  }
  async function checkPending() {
    const p = permitRef.current, attempt = pendingRef.current;
    if (!p || !attempt || !open(p)) return;
    const item = await getCapsule(scope, p, attempt.id); if (!open(p)) return;
    if (item?.lastOperation === attempt.operation_id) {
      pendingRef.current = null; setPending(null); setDraft(null); setVoice(undefined); setConfirmTrash(false);
      setNotice('Действие подтверждено сервером.'); await refresh(p);
    } else if ((item && item.version !== attempt.expected_version) || (!item && attempt.expected_version !== -1)) {
      pendingRef.current = null; setPending(null); setVoice(undefined); setConfirmTrash(false);
      setDraft(item ? { id: item.id, version: item.version, title: item.title, letter: item.letter, childId: item.child_id, files: item.files, archived: item.archived } : null);
      setNotice('Загружена актуальная версия. Предыдущее действие не повторяется поверх чужих изменений.'); await refresh(p);
    } else setNotice('Сервер ещё не подтвердил действие. Можно повторить тот же запрос кнопкой сохранения — новая капсула не создастся.');
  }
  async function attach(assets: MemoryAsset[], d: Draft, p: CapsulePermit) {
    if (!open(p) || !keyRef.current) return;
    if (d.files.length + assets.length > 5) throw new CapsuleError('В капсуле может быть до пяти вложений.', 'invalid');
    const files = [...d.files];
    for (const asset of assets) {
      const next = await uploadCapsuleFile(scope, p, d.id, asset, keyRef.current, () => open(p));
      if (!open(p)) return;
      files.push(next); setDraft({ ...d, files: [...files] });
    }
  }
  async function finishUnlock(p: CapsulePermit, ticket: number) {
    if (!base() || !foreground.current || ticket !== epoch.current) { void lockCapsuleVault(scope, p).catch(() => {}); return; }
    permitRef.current = p; setPermit(p); setPassword(''); setConfirmation(''); setAccountPassword(''); setRecovery(false);
    setShowPassword(false); setShowAccountPassword(false); setBiometricWanted(false);
    let key: string;
    try { key = await capsuleKey(scope, p); }
    catch (e) { if (open(p)) { lock(); setError(e instanceof Error ? e.message : 'Не удалось открыть раздел. Повторите вход.'); } throw e; }
    if (!open(p)) return; keyRef.current = key;
    await refresh(p);
    const saved = resume.current; resume.current = null;
    if (saved && open(p)) {
      setDraft(saved.draft); setVoice(saved.voice); pendingRef.current = saved.attempt ?? null; setPending(saved.attempt ?? null);
      setNotice(saved.attempt ? 'Черновик восстановлен. Проверьте состояние предыдущего сохранения на сервере.' : 'Черновик восстановлен после входа в раздел.');
      if (!saved.attempt) await attach(saved.assets, saved.draft, p);
    }
  }
  async function unlock(ticket: number) {
    if (permitRef.current) return;
    const typedPassword = password;
    if (recovery || configured === false) {
      if (password !== confirmation) throw new CapsuleError('Пароли раздела не совпадают.', 'invalid');
      if (recovery) {
        await resetCapsulePassword(scope, accountPassword, typedPassword);
        await disableCapsuleBiometry(scope);
        if (base() && ticket === epoch.current) setBio(value => ({ ...value, enabled: false }));
      }
      else await setupCapsuleVault(scope, password);
      if (!base() || ticket !== epoch.current) return;
      setConfigured(true);
    }
    const p = await unlockCapsuleVault(scope, typedPassword);
    let handedOff = false;
    try {
      if (!base() || !foreground.current || ticket !== epoch.current) return;
      if (biometricWanted && bio.available) {
        setPassword(''); setConfirmation(''); setAccountPassword(''); setShowPassword(false); setShowAccountPassword(false);
        biometricPrompt.current = true;
        try { await enableCapsuleBiometry(scope, typedPassword, () => base() && ticket === epoch.current); }
        finally { biometricPrompt.current = false; }
        if (!await waitUntilActive(ticket)) return;
        setBio(value => ({ ...value, enabled: true })); setNotice('Биометрический вход включён только на этом телефоне.');
      }
      handedOff = true; await finishUnlock(p, ticket);
    } finally { if (!handedOff) void lockCapsuleVault(scope, p).catch(() => {}); }
  }
  async function unlockBiometry(ticket: number) {
    if (permitRef.current || !bio.enabled || !bio.available || recovery) return;
    setPassword(''); setConfirmation(''); setAccountPassword(''); setShowPassword(false); setShowAccountPassword(false);
    biometricPrompt.current = true;
    let cached: string | null;
    try { cached = await readCapsuleBiometry(scope, () => base() && ticket === epoch.current); }
    finally { biometricPrompt.current = false; }
    if (!await waitUntilActive(ticket)) return;
    if (!cached) {
      setBio(value => ({ ...value, enabled: false }));
      throw new CapsuleError('Войдите по паролю и включите биометрию заново. Настройки отпечатка могли измениться.', 'invalid');
    }
    let p: CapsulePermit;
    try { p = await unlockCapsuleVault(scope, cached); }
    catch (e) {
      if (e instanceof CapsuleError && e.reason === 'bad_password') {
        await disableCapsuleBiometry(scope); if (base() && ticket === epoch.current) setBio(value => ({ ...value, enabled: false }));
      }
      throw e;
    }
    await finishUnlock(p, ticket);
  }
  async function select(c: Capsule) {
    const p = permitRef.current; if (!p || !open(p)) return;
    const item = await getCapsule(scope, p, c.id); if (!open(p)) return;
    if (!item) throw new CapsuleError('Капсула не найдена. Обновите список.');
    keyRef.current = item.keyHex;
    setDraft({ id: item.id, version: item.version, title: item.title, letter: item.letter, childId: item.child_id, files: item.files, archived: item.archived });
    setPending(null); setVoice(undefined); setConfirmTrash(false); setNotice(null);
  }
  async function pick() {
    const p = permitRef.current, d = draftRef.current; if (!p || !d || !open(p) || pendingRef.current) return;
    if (d.files.length >= 5 || voice) throw new CapsuleError('Сначала сохраните голос или уберите лишний файл.', 'invalid');
    picking.current = true; resume.current = { draft: { ...d, files: [...d.files] }, assets: [] };
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true,
        selectionLimit: 5 - d.files.length, allowsEditing: false, quality: 1 });
      if (!base()) { resume.current = null; return; }
      const assets = result.canceled ? [] : result.assets;
      if (!open(p)) {
        if (resume.current) resume.current.assets = assets;
        setNotice('Вернулись из галереи. Введите пароль, чтобы продолжить черновик.'); return;
      }
      resume.current = null; await attach(assets, d, p);
    } finally { picking.current = false; }
  }
  async function save() {
    const p = permitRef.current, d = draftRef.current; if (!p || !d || !open(p) || !keyRef.current) return;
    let attempt = pendingRef.current;
    if (!attempt) {
      let files = d.files;
      if (voice) {
        const uploaded = await uploadCapsuleFile(scope, p, d.id, voice, keyRef.current, () => open(p));
        if (!open(p)) return;
        files = [...files, uploaded]; setDraft({ ...d, files }); setVoice(undefined);
      }
      attempt = await prepareCapsuleWrite({ id: d.id, expectedVersion: d.version, title: d.title, childId: d.childId, letter: d.letter, files, keyHex: keyRef.current });
      if (!open(p)) return; pendingRef.current = attempt; setPending(attempt);
    }
    await commitCapsuleWrite(scope, p, attempt); if (!open(p)) return;
    pendingRef.current = null; setPending(null); setDraft(null); setVoice(undefined); setConfirmTrash(false); setNotice('Капсула сохранена на сервере. После выхода из аккаунта она останется здесь.'); await refresh(p);
  }
  async function archive() {
    const p = permitRef.current, d = draftRef.current; if (!p || !d || !open(p)) return;
    const c: Capsule = { id: d.id, child_id: d.childId, title: d.title, version: d.version, archived: d.archived, updated_at: '' };
    const attempt = pendingRef.current ?? archiveCapsuleWrite(c, !d.archived);
    pendingRef.current = attempt; setPending(attempt);
    await commitCapsuleWrite(scope, p, attempt); if (!open(p)) return;
    pendingRef.current = null; setPending(null); setDraft(null); setConfirmTrash(false); setNotice(d.archived ? 'Капсула восстановлена.' : 'Капсула перемещена в закрытую корзину.'); await refresh(p);
  }
  async function viewFile(f: CapsuleFile) {
    const p = permitRef.current; if (!p || !keyRef.current || !open(p)) return;
    const bytes = await downloadCapsuleFile(scope, p, f); if (!open(p)) return;
    const plaintext = await decryptCapsuleBytes(bytes, keyRef.current); if (!open(p)) return;
    const local = await capsuleTemporaryFile(plaintext, f);
    if (!open(p)) { local.dispose(); return; }
    disposeTemp(); temp.current = local; setViewer({ ...f, signed_url: local.uri });
  }
  function closeViewer() { disposeTemp(); if (alive.current) setViewer(null); }
  function requestBack() {
    if (!base()) { router.back(); return; }
    if (!foreground.current || renderEpoch !== epoch.current) return;
    if (busyRef.current || voiceBusy.current || pendingRef.current) { setError('Сначала дождитесь результата или проверьте сохранение на сервере.'); return; }
    if (draftRef.current || resume.current) { exit.current = { run: () => router.back(), ticket: epoch.current }; setDiscard('back'); }
    else { lock(); router.back(); }
  }
  function confirmDiscard() {
    if (!passwordLive() || voiceBusy.current || pendingRef.current) return;
    if (discard === 'back') setAllowExit(true);
    else if (discard === 'list' && open()) { setDraft(null); setVoice(undefined); setDiscard(null); resume.current = null; }
  }
  const children = auth.family.status === 'ready' ? auth.family.children : [];
  if (!owner || !form.valid) return <FamilyFormScreen title="Капсула времени" onBack={() => router.back()}><Text style={ui.hint}>Раздел доступен только создателю семьи.</Text></FamilyFormScreen>;
  const locked = !permit || !form.focused || !foreground.current || permitRef.current !== permit;
  const choice = configured === true && bio.available && bio.enabled && !passwordMode && !recovery && !biometricWanted;
  const biometricLoginLabel = bio.label === 'Отпечаток пальца' ? 'Войти по отпечатку' : 'Войти по биометрии';
  const blocked = busy || recording || Boolean(pending);
  const listVisible = !locked && !draft;
  return <FamilyFormScreen title="Капсула времени" scroll={!listVisible} onBack={requestBack}>
    {discard ? <View style={ui.card}>
      <Text style={styles.title}>Выйти без сохранения?</Text><Text style={ui.hint}>Несохранённые изменения письма будут потеряны. Уже сохранённые капсулы останутся на сервере.</Text>
      <FormButton label="Остаться и сохранить" primary disabled={busy || recording} onPress={() => { if (passwordLive()) { setDiscard(null); exit.current = null; } }} />
      <FormButton label="Выйти без сохранения" danger disabled={busy || recording || Boolean(pending)} onPress={confirmDiscard} />
    </View> : null}
    {locked ? <>
      <View style={styles.intro}><StoryIcon name="lock" color={colors.primary} size={38} /><Text style={styles.title}>Личное послание в будущее</Text>
        <Text style={ui.hint}>Письма, фото, видео и голос — только для вас. Родственники не имеют доступа, даже зная пароль. Даты открытия нет: вы решаете, когда показать ребёнку.</Text></View>
      {configured === null || !bioChecked ? error ? <FormButton label="Повторить проверку раздела" disabled={busy} onPress={() => void work(async () => {
        const value = await capsuleConfigured(scope); if (base() && foreground.current) setConfigured(value);
      })} /> : <ActivityIndicator color={colors.primary} /> : choice ? <>
        <Text style={styles.title}>Как открыть капсулу?</Text>
        <FormButton label={biometricLoginLabel} primary disabled={busy} onPress={() => void work(unlockBiometry)} />
        <FormButton label="Ввести пароль" disabled={busy} onPress={() => gateMode(true)} />
        <Text style={ui.hint}>Выберите один способ. Для входа по отпечатку пароль вводить не нужно. Обычный пароль остаётся запасным вариантом.</Text>
      </> : <>
        {biometricWanted ? <Text style={styles.title}>Подключение биометрии — один раз</Text> : null}
        <Text style={ui.label}>{recovery ? 'Новый пароль раздела' : configured ? 'Пароль капсулы' : 'Придумайте пароль раздела'}</Text>
        {recovery ? <View style={styles.passwordRow}>
          <TextInput accessibilityLabel="Пароль аккаунта для восстановления капсулы" secureTextEntry={!showAccountPassword} autoCapitalize="none" autoCorrect={false} value={accountPassword} onChangeText={v => { if (passwordLive()) setAccountPassword(v); }} editable={!busy} style={styles.passwordInput} placeholder="Пароль вашего аккаунта" />
          <Pressable accessibilityRole="button" accessibilityLabel={showAccountPassword ? 'Скрыть пароль аккаунта' : 'Показать пароль аккаунта'} disabled={busy} onPress={() => { if (passwordLive()) setShowAccountPassword(v => !v); }} style={styles.eyeButton}><Text style={styles.eyeText}>{showAccountPassword ? 'Скрыть' : 'Показать'}</Text></Pressable>
        </View> : null}
        <View style={styles.passwordRow}>
          <TextInput accessibilityLabel="Пароль раздела капсул" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} maxLength={64} value={password} onChangeText={v => { if (passwordLive()) setPassword(v); }} editable={!busy} style={styles.passwordInput} placeholder="Не менее 8 символов" />
          <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Скрыть пароль капсулы' : 'Показать пароль капсулы'} disabled={busy} onPress={() => { if (passwordLive()) setShowPassword(v => !v); }} style={styles.eyeButton}><Text style={styles.eyeText}>{showPassword ? 'Скрыть' : 'Показать'}</Text></Pressable>
        </View>
        {!configured || recovery ? <View style={styles.passwordRow}>
          <TextInput accessibilityLabel="Повторить пароль капсул" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} maxLength={64} value={confirmation} onChangeText={v => { if (passwordLive()) setConfirmation(v); }} editable={!busy} style={styles.passwordInput} placeholder="Повторите пароль" />
          <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Скрыть подтверждение пароля' : 'Показать подтверждение пароля'} disabled={busy} onPress={() => { if (passwordLive()) setShowPassword(v => !v); }} style={styles.eyeButton}><Text style={styles.eyeText}>{showPassword ? 'Скрыть' : 'Показать'}</Text></Pressable>
        </View> : null}
        {!recovery && bio.available ? <>
          {bio.enabled ? <>
            <FormButton label="Назад к выбору способа входа" disabled={busy} onPress={() => gateMode(false)} />
            <FormButton label="Отключить биометрию на этом телефоне" disabled={busy} onPress={() => void work(async ticket => { await disableCapsuleBiometry(scope); if (base() && ticket === epoch.current) setBio(value => ({ ...value, enabled: false })); })} />
          </> : configured ? <FormButton label={biometricWanted ? 'Вернуться к входу по паролю' : 'Настроить вход по биометрии'} disabled={busy} onPress={() => gateMode(true, !biometricWanted)} /> : null}
          {biometricWanted ? <Text style={ui.hint}>Пароль проверяется только для подключения отпечатка на этом телефоне. В дальнейшем можно сразу входить по отпечатку без ввода пароля.</Text> : null}
          <Text style={ui.hint}>Любой отпечаток или лицо, зарегистрированные на этом телефоне, могут пройти проверку. Если добавлена биометрия ребёнка, оставьте только пароль. Доступ родственникам из их аккаунтов не открывается.</Text>
        </> : !recovery && bio.reason ? <Text style={ui.hint}>{bio.reason}</Text> : null}
        <FormButton label={busy ? 'Проверяем…' : biometricWanted ? 'Включить биометрию' : recovery ? 'Подтвердить и сменить пароль' : configured ? 'Открыть капсулы' : 'Создать защищённый раздел'} primary disabled={busy || configured === null} onPress={() => void work(unlock)} />
        {configured ? <FormButton label={recovery ? 'Вернуться к открытию' : 'Забыли пароль капсулы?'} disabled={busy} onPress={() => { if (passwordLive()) { setRecovery(!recovery); setPassword(''); setConfirmation(''); setAccountPassword(''); setShowPassword(false); setShowAccountPassword(false); setBiometricWanted(false); setError(null); } }} /> : null}
        <Text style={ui.hint}>Пароль раздела — отдельный от аккаунта. Восстановление требует подтверждения пароля аккаунта. При сворачивании раздел закрывается; черновик можно вернуть после ввода пароля, пока приложение не завершено.</Text>
      </>}
    </> : draft ? <>
      <Text style={ui.label}>{draft.archived ? 'Капсула в корзине' : draft.version < 0 ? 'Новое послание' : 'Ваше послание'}</Text>
      {!draft.archived ? <Text style={ui.hint}>Сохраните письмо перед выходом из раздела. Черновик не хранится на диске и может потеряться при завершении приложения.</Text> : null}
      <TextInput accessibilityLabel="Название капсулы" value={draft.title} onChangeText={title => update({ title })} maxLength={120} editable={!blocked && !draft.archived} style={ui.input} placeholder="Например: Асе, когда она вырастет" />
      <Text style={ui.label}>Для кого</Text><View style={styles.chips}>
        <FormButton label="Для семьи" disabled={blocked || draft.archived} onPress={() => update({ childId: null })} />
        {children.map(child => <FormButton key={child.id} label={`${draft.childId === child.id ? '✓ ' : ''}${child.name}`} disabled={blocked || draft.archived} onPress={() => update({ childId: child.id })} />)}
      </View>
      <TextInput accessibilityLabel="Письмо ребёнку" value={draft.letter} onChangeText={letter => update({ letter })} multiline maxLength={8000} editable={!blocked && !draft.archived} style={[ui.input, styles.letter]} placeholder="Расскажите, каким вы видите его будущее, что любите и что хотите сохранить…" />
      {draft.files.map((f, index) => <View key={f.id} style={ui.card}>
        <FormButton label={`Открыть ${f.media_type === 'video' ? 'видео' : f.media_type === 'audio' ? 'голос' : 'фото'} ${index + 1}`} disabled={busy || recording} onPress={() => void work(() => viewFile(f))} />
        {!draft.archived ? <FormButton label={`Убрать вложение ${index + 1} из письма`} disabled={blocked} onPress={() => update({ files: draft.files.filter(entry => entry.id !== f.id) })} /> : null}
      </View>)}
      {!draft.archived ? <>
        <FormButton label="Добавить фото или видео" disabled={blocked || draft.files.length >= 5 || Boolean(voice)} onPress={() => void work(pick)} />
        <VoiceRecorder asset={voice} disabled={busy || Boolean(pending)} canAdd={draft.files.length < 5}
          onChange={v => { if (open() && !busyRef.current && !pendingRef.current) setVoice(v ?? undefined); }}
          onBusyChange={value => { if (open()) { voiceBusy.current = value; setRecording(value); } }} />
        <FormButton label={pending?.action === 'archive' ? 'Повторить перемещение в корзину' : pending ? 'Проверить и повторить сохранение' : 'Сохранить капсулу'} primary disabled={busy || recording} onPress={() => void work(pending?.action === 'archive' ? archive : save)} />
      </> : <FormButton label="Вернуть из корзины" primary disabled={busy} onPress={() => void work(archive)} />}
      {pending ? <FormButton label="Проверить состояние на сервере" disabled={busy || recording} onPress={() => void work(checkPending)} /> : null}
      {draft.version >= 0 && !draft.archived && !pending ? <>
        <FormButton label="Переместить капсулу в корзину" danger disabled={busy || recording} onPress={() => { if (open() && !busyRef.current && !voiceBusy.current) setConfirmTrash(true); }} />
        {confirmTrash ? <View style={ui.card}><Text style={ui.hint}>Послание будет убрано из списка. Его можно восстановить — файлы не удаляются навсегда.</Text>
          <FormButton label="Подтвердить перемещение" danger disabled={busy} onPress={() => void work(archive)} />
          <FormButton label="Оставить капсулу" onPress={() => setConfirmTrash(false)} /></View> : null}
      </> : null}
      <FormButton label="Вернуться к списку без сохранения" disabled={busy || recording || Boolean(pending)} onPress={() => { if (open() && !busyRef.current && !voiceBusy.current && !pendingRef.current) setDiscard('list'); }} />
    </> : <FlatList style={{ flex: 1 }} data={rows} keyExtractor={item => item.id} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
      contentContainerStyle={[ui.content, { gap: 0 }]} showsVerticalScrollIndicator={false}
      ListHeaderComponent={<View style={{ gap: 14, marginBottom: 14 }}>
        <Text style={ui.hint}>Только создатель семьи. Открытый раздел автоматически закроется через 10 минут или при уходе в фон.</Text>
        <Text style={styles.title}>Сохранённые капсулы</Text>
        {notice ? <Text accessibilityLiveRegion="polite" style={ui.hint}>{notice}</Text> : null}
        {error ? <Text accessibilityLiveRegion="polite" style={ui.error}>{error}</Text> : null}
        {listState === 'error' ? <Text style={ui.hint}>Не удалось загрузить список. Это не означает, что капсулы исчезли. Нажмите «Обновить список капсул».</Text> : null}
        <View style={styles.chips}><FormButton label="Мои капсулы" primary={!trash} disabled={busy} onPress={() => void work(() => changeList(false))} /><FormButton label="Корзина капсул" primary={trash} disabled={busy} onPress={() => void work(() => changeList(true))} /></View>
        {!trash ? <FormButton label="Создать послание" primary disabled={busy || listState !== 'ready'} onPress={() => { if (open() && !busyRef.current && listState === 'ready') { setDraft({ id: randomUUID(), version: -1, title: '', letter: '', childId: children[0]?.id ?? null, files: [], archived: false }); setNotice(null); } }} /> : null}
      </View>}
      renderItem={({ item: c }) => <Pressable accessibilityRole="button" accessibilityLabel={`Открыть капсулу ${c.title}`} disabled={busy}
        onPress={() => { if (open()) void work(() => select(c)); }} style={[ui.card, { marginBottom: 12 }]}><Text style={styles.title}>{c.title}</Text><Text style={ui.hint}>{children.find(child => child.id === c.child_id)?.name ?? 'Для семьи'}</Text></Pressable>}
      ListEmptyComponent={!busy && listState === 'ready' ? <Text style={ui.hint}>{trash ? 'Здесь будут капсулы, которые вы убрали из списка.' : 'Пока нет сохранённых посланий. Создайте письмо и нажмите «Сохранить капсулу».'}</Text> : null}
      ListFooterComponent={<View style={{ gap: 14, marginTop: 14 }}>
        {cursor ? <FormButton label="Показать ещё капсулы" disabled={busy} onPress={() => void work(loadMore)} /> : null}
        <FormButton label="Обновить список капсул" disabled={busy} onPress={() => void work(() => permitRef.current ? refresh(permitRef.current) : Promise.resolve())} />
        {bio.available && !bio.enabled ? <FormButton label="Настроить вход по биометрии" disabled={busy} onPress={() => { if (open() && !busyRef.current) { lock(); setBiometricWanted(true); setPasswordMode(true); } }} /> : null}
        <FormButton label="Закрыть капсулы" onPress={() => lock()} />
      </View>} />}
    {busy ? <ActivityIndicator color={colors.primary} /> : null}
    {!listVisible && notice ? <Text accessibilityLiveRegion="polite" style={ui.hint}>{notice}</Text> : null}
    {!listVisible && error ? <Text accessibilityLiveRegion="polite" style={ui.error}>{error}</Text> : null}
    {open() && viewer ? viewer.media_type === 'image' ? <PhotoViewer key={viewer.id} photos={[viewer]} initialId={viewer.id} title="Фото из капсулы" caption="" onClose={closeViewer} />
      : viewer.media_type === 'video' ? <VideoViewer key={viewer.id} media={viewer} title="Видеообращение" caption="" onClose={closeViewer} />
      : <AudioViewer key={viewer.id} media={viewer} title="Голос на память" onClose={closeViewer} /> : null}
  </FamilyFormScreen>;
}
const styles = StyleSheet.create({ intro: { gap: 14, marginBottom: 10 }, title: { fontSize: 21, fontWeight: '700', color: colors.ink },
  passwordRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface },
  passwordInput: { flex: 1, minHeight: 56, paddingLeft: 16, paddingRight: 8, fontSize: 16, color: colors.ink },
  eyeButton: { minWidth: 78, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingRight: 12 }, eyeText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, letter: { minHeight: 180, textAlignVertical: 'top' } });
