import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { FamilyFormScreen, FormButton, familyFormStyles as s } from '../../components/family-form-ui';
import { useFamilyFormScope } from '../../components/use-family-form-scope';
import { loadEditableMemory, prepareMemoryEdit, saveMemoryEdit, validateMemoryEditAttempt, MemoryEditError,
  type EditableMemory, type MemoryEditAttempt } from '../../lib/memory-editing-service';
import { getMemoryLifecycle, setMemoryArchived, validateLifecycleAttempt, FamilyOperationError, type LifecycleAttempt, type MemoryLifecycle } from '../../lib/family-access-service';
import { readOperation, writeOperation, clearOperation, operationKey } from '../../lib/family-operation-journal';

export default function EditMemoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { auth, live, valid } = useFamilyFormScope();
  const userId = auth.session?.user.id ?? '';
  const familyId = auth.family.status === 'ready' ? auth.family.family.id : '';
  const initialId = useRef(id); const currentId = useRef(id); currentId.current = id;
  const current = () => live() && initialId.current === currentId.current;
  const busy = useRef(false);
  const [loading, setLoading] = useState(true);
  const [memory, setMemory] = useState<EditableMemory | null>(null);
  const [state, setState] = useState<MemoryLifecycle | null>(null);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [date, setDate] = useState(''); const [childIds, setChildIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<MemoryEditAttempt | null>(null);
  const [lifeAttempt, setLifeAttempt] = useState<LifecycleAttempt | null>(null);
  const [confirmedDelete, setConfirmedDelete] = useState(false);
  const [journalBroken, setJournalBroken] = useState(false);
  const latest = useRef({ memory, state, attempt, lifeAttempt, journalBroken, confirmedDelete, title, body, date, childIds });
  latest.current = { memory, state, attempt, lifeAttempt, journalBroken, confirmedDelete, title, body, date, childIds };
  const editKey = operationKey('edit',userId,familyId,id);
  const lifeKey = operationKey('lifecycle',userId,familyId,id);
  usePreventRemove(valid && loading, () => {});
  function fill(m: EditableMemory) {
    Object.assign(latest.current, { memory:m, title:m.details.title ?? '', body:m.details.body ?? '', date:m.details.eventDate, childIds:m.details.childIds });
    setMemory(m); setTitle(m.details.title ?? ''); setBody(m.details.body ?? ''); setDate(m.details.eventDate); setChildIds(m.details.childIds);
  }
  function canChange() { const row=latest.current; return current() && !busy.current && Boolean(row.memory) && !row.attempt && !row.lifeAttempt && !row.journalBroken; }
  async function load() {
    if (!current() || busy.current) return;
    busy.current=true; setLoading(true); setError(null);
    setMemory(null); setState(null); setConfirmedDelete(false);
    Object.assign(latest.current, { memory:null, state:null, confirmedDelete:false });
    let journalsValid = false;
    try {
      const pendingEdit = readOperation(editKey);
      const rawLife = readOperation(lifeKey);
      const pendingLife = rawLife ? validateLifecycleAttempt(rawLife as LifecycleAttempt) : null;
      let edit: MemoryEditAttempt | null = null;
      if (pendingEdit) {
        edit = validateMemoryEditAttempt(pendingEdit as MemoryEditAttempt);
        if (edit.userId!==userId || edit.familyId!==familyId || edit.memoryId!==id) throw new Error('Локальная отправка принадлежит другому воспоминанию.');
      }
      if (pendingLife && (pendingLife.userId!==userId || pendingLife.familyId!==familyId || pendingLife.memoryId!==id)) throw new Error('Не удалось прочитать локальное удаление.');
      if (edit && pendingLife) throw new Error('Нужна проверка двух незавершённых операций. Не отправляйте новую.');
      if (!current()) return;
      journalsValid = true;
      Object.assign(latest.current, { attempt:edit, lifeAttempt:pendingLife, journalBroken:false });
      setAttempt(edit); setLifeAttempt(pendingLife); setJournalBroken(false);
      const lifecycle = await getMemoryLifecycle(userId,familyId,id);
      if (!current()) return;
      latest.current.state=lifecycle; setState(lifecycle);
      if (!lifecycle.archived) {
        const m = await loadEditableMemory({ userId,familyId,memoryId:id });
        if (!current()) return;
        fill(m);
        if (edit) { Object.assign(latest.current, { title:edit.desired.title ?? '', body:edit.desired.body ?? '', date:edit.desired.eventDate, childIds:edit.desired.childIds }); setTitle(edit.desired.title ?? ''); setBody(edit.desired.body ?? ''); setDate(edit.desired.eventDate); setChildIds(edit.desired.childIds); }
      }
      if (edit || pendingLife) setError('Есть незавершённое действие. Повторим его с прежними исходными данными.');
    } catch (e) {
      if (current()) { setError(e instanceof Error ? e.message : 'Не удалось открыть воспоминание.');
        // Preserve unreadable journals; do not overwrite them with a new send.
        if (!journalsValid) { latest.current.journalBroken=true; setJournalBroken(true); } }
    } finally { busy.current=false; if(current()) setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function save() {
    const row=latest.current;
    if (!current() || busy.current || (!row.memory && !row.attempt) || row.journalBroken || row.lifeAttempt) return;
    busy.current=true; setLoading(true); setError(null);
    let request = row.attempt;
    try {
      request ??= prepareMemoryEdit({ userId,memory:row.memory!,details:{ title:row.title,body:row.body,eventDate:row.date,childIds:row.childIds } });
      writeOperation(editKey,request); latest.current.attempt=request; setAttempt(request);
      await saveMemoryEdit(request);
      try { clearOperation(editKey); } catch { /* A replay reconciles the achieved state. */ }
      if (current()) router.back();
    } catch(e) {
      if(current()) {
        setError(e instanceof Error ? e.message : 'Ответ не получен. Повторите то же действие.');
        if (latest.current.attempt && e instanceof MemoryEditError && ['conflict','invalid','forbidden','unavailable'].includes(e.kind)) {
          // An explicit rejected RPC / conflicting CAS cannot apply this snapshot.
          try { clearOperation(editKey); latest.current.attempt=null; setAttempt(null); } catch { latest.current.journalBroken=true; setJournalBroken(true); }
          latest.current.memory=null; setMemory(null);
        }
      }
    } finally { busy.current=false; if(current()) setLoading(false); }
  }
  async function archive() {
    const row=latest.current;
    if (!current() || busy.current || (!row.state && !row.lifeAttempt) || row.journalBroken || row.attempt || (!row.confirmedDelete && !row.lifeAttempt)) return;
    busy.current=true; setLoading(true); setError(null);
    try {
      const request = row.lifeAttempt ?? { userId,familyId,memoryId:id,expectedVersion:row.state!.version,archived:!row.state!.archived,operationId:Crypto.randomUUID() };
      writeOperation(lifeKey,request); latest.current.lifeAttempt=request; setLifeAttempt(request);
      await setMemoryArchived(request);
      try { clearOperation(lifeKey); } catch { /* Server receipt prevents stale replay. */ }
      if(current()) router.back();
    } catch(e) {
      if(current()) {
        setError(e instanceof Error ? e.message : 'Результат пока не подтверждён.');
        if(e instanceof FamilyOperationError && ['conflict','forbidden','invalid'].includes(e.kind)) {
          try { clearOperation(lifeKey); latest.current.lifeAttempt=null; setLifeAttempt(null); } catch { latest.current.journalBroken=true; setJournalBroken(true); }
          latest.current.state=null; latest.current.memory=null; setState(null); setMemory(null);
        }
      }
    } finally { busy.current=false; if(current()) setLoading(false); }
  }
  const locked = loading || Boolean(attempt || lifeAttempt) || journalBroken || !memory;
  return <FamilyFormScreen title="Воспоминание" onBack={() => { if(current() && !busy.current) router.back(); }}>
    {error ? <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
    {loading ? <Text style={s.hint}>Проверяем данные…</Text> : null}
    {state?.archived ? <Text style={s.hint}>Воспоминание в корзине. Оригиналы сохранены. Восстановление вернёт его в альбом.</Text> : <>
      <Text style={s.label}>Заголовок</Text><TextInput accessibilityLabel="Заголовок воспоминания" style={s.input} editable={!locked} value={title} maxLength={120} onChangeText={(v) => { if(canChange()) { latest.current.title=v; setTitle(v); } }} />
      <Text style={s.label}>Текст</Text><TextInput accessibilityLabel="Текст воспоминания" multiline style={[s.input,{ minHeight:120,textAlignVertical:'top' }]} editable={!locked} value={body} maxLength={4000} onChangeText={(v) => { if(canChange()) { latest.current.body=v; setBody(v); } }} />
      <Text style={s.label}>Дата события</Text><TextInput accessibilityLabel="Дата события ГГГГ-ММ-ДД" style={s.input} editable={!locked} value={date} maxLength={10} placeholder="2024-02-19" onChangeText={(v) => { if(canChange()) { latest.current.date=v; setDate(v); } }} />
      <Text style={s.label}>Дети на этом воспоминании</Text>
      <View style={{ gap:8 }}>{auth.family.status==='ready' ? auth.family.children.map(child => <FormButton key={child.id} label={`${childIds.includes(child.id) ? '✓ ' : ''}${child.name}`} disabled={locked}
        onPress={() => { if(canChange()) { const ids=latest.current.childIds; const next=ids.includes(child.id) ? ids.filter(v => v!==child.id) : [...ids,child.id]; latest.current.childIds=next; setChildIds(next); } }} />) : null}</View>
      <Text style={s.hint}>Фото и видео при правке не заменяются. Конфликт с другой правкой не перезапишет её молча.</Text>
    </>}
    {!state?.archived || attempt ? <FormButton primary label={attempt ? 'Проверить и повторить правку' : 'Сохранить изменения'} disabled={loading || (!memory && !attempt) || Boolean(lifeAttempt) || journalBroken} onPress={() => void save()} /> : null}
    {(state || lifeAttempt) && !attempt && !journalBroken ? <>
      {!confirmedDelete && !lifeAttempt ? <FormButton label={state?.archived ? 'Восстановить воспоминание' : 'Перенести в корзину'} danger={!state?.archived} disabled={loading} onPress={() => { if(current() && !busy.current && !latest.current.attempt) { latest.current.confirmedDelete=true; setConfirmedDelete(true); } }} /> : <>
        <Text style={s.hint}>{lifeAttempt ? 'Повтор использует прежний номер операции.' : state?.archived ? 'Вернуть запись и все её файлы в альбом?' : 'Убрать запись из альбома? Все файлы сохранятся в корзине. Безвозвратного удаления здесь нет.'}</Text>
        <FormButton label={lifeAttempt ? 'Проверить и повторить действие' : state?.archived ? 'Подтвердить восстановление' : 'Подтвердить перенос в корзину'} disabled={loading} onPress={() => void archive()} />
        {!lifeAttempt ? <FormButton label="Отмена" disabled={loading} onPress={() => { if(current() && !busy.current) { latest.current.confirmedDelete=false; setConfirmedDelete(false); } }} /> : null}
      </>}
    </> : null}
    <FormButton label="Загрузить актуальную версию" disabled={loading || Boolean(attempt || lifeAttempt)} onPress={() => void load()} />
  </FamilyFormScreen>;
}
