import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Share, Text, View } from 'react-native';
import { FamilyFormScreen, FormButton, familyFormStyles as s } from '../../components/family-form-ui';
import { useFamilyFormScope } from '../../components/use-family-form-scope';
import { getFamilyAccess, createInvitation, newInvitation, revokeInvitation, removeFamilyMember,
  invitationCode, checkedId, type InvitationAttempt, type FamilyAccess, type FamilyMember } from '../../lib/family-access-service';
import { FamilyOperationError } from '../../lib/family-access-service';
import { readOperation, writeOperation, clearOperation, operationKey } from '../../lib/family-operation-journal';

export default function FamilyMembersScreen() {
  const router=useRouter(); const { auth,live,valid,focused }=useFamilyFormScope();
  const userId=auth.session?.user.id ?? ''; const familyId=auth.family.status==='ready' ? auth.family.family.id : '';
  const owner=auth.family.status==='ready' && auth.family.family.role==='owner';
  const busy=useRef(false); const [loading,setLoading]=useState(true); const [data,setData]=useState<FamilyAccess | null>(null);
  const [error,setError]=useState<string | null>(null); const [draft,setDraft]=useState<InvitationAttempt | null>(null);
  const pending=useRef<InvitationAttempt | null>(null); const [shareCode,setShareCode]=useState<string | null>(null);
  const [confirmation,setConfirmation]=useState<FamilyMember | null>(null); const [broken,setBroken]=useState(false);
  const confirmed=useRef(confirmation);confirmed.current=confirmation;
  const blocked=useRef(broken);blocked.current=broken;
  const key=operationKey('invite',userId,familyId);
  async function load() {
    if(!live() || busy.current) return; busy.current=true;setLoading(true);setError(null);
    let journalValid=false;
    try {
      const saved=readOperation(key) as InvitationAttempt | null;
      if(saved) {
        if(saved.userId!==userId || saved.familyId!==familyId) throw new Error('Незавершённое приглашение принадлежит другой семье.');
        checkedId(saved.id); invitationCode(saved.token);
      }
      if(!live()) return;
      journalValid=true;pending.current=saved;setDraft(saved);blocked.current=false;setBroken(false);
      const access=await getFamilyAccess(userId,familyId);
      if(live()) { setData(access); if(saved) setError('Есть незавершённое приглашение. Проверим прежний код без создания второго.'); }
    } catch(e) { if(live()) { setError(e instanceof Error ? e.message : 'Не удалось загрузить семью.'); if(!journalValid){blocked.current=true;setBroken(true);} } }
    finally { busy.current=false;if(live())setLoading(false); }
  }
  useEffect(()=>{if(focused)void load();},[focused]);
  async function invite() {
    if(!live() || busy.current || !owner || blocked.current) return;busy.current=true;setLoading(true);setError(null);
    try {
      const request=pending.current ?? newInvitation(userId,familyId);
      writeOperation(key,request);pending.current=request;setDraft(request);
      const result=await createInvitation(request);
      if(!live())return;
      if(result.revoked_at || result.accepted_at || Date.parse(result.expires_at)<=Date.now()) {
        clearOperation(key);pending.current=null;setDraft(null);setShareCode(null);
        setError('Это приглашение уже недействительно. Можно создать новое.');
      } else { setShareCode(request.token);setError(null); }
      const access=await getFamilyAccess(userId,familyId);if(live())setData(access);
    } catch(e) { if(live()){
      setError(e instanceof Error ? e.message : 'Результат пока не подтверждён.');
      if(e instanceof FamilyOperationError && ['invalid','forbidden'].includes(e.kind)){
        try{clearOperation(key);pending.current=null;setDraft(null);setShareCode(null);}catch{blocked.current=true;setBroken(true);}
      }
    } }
    finally { busy.current=false;if(live())setLoading(false); }
  }
  async function revoke(id: string) {
    if(!live() || busy.current || !owner) return;busy.current=true;setLoading(true);setError(null);
    try {
      await revokeInvitation(userId,familyId,id);
      if(pending.current?.id===id) { clearOperation(key);pending.current=null;if(live()){setDraft(null);setShareCode(null);} }
      const access=await getFamilyAccess(userId,familyId);if(live())setData(access);
    } catch(e) { if(live())setError(e instanceof Error ? e.message : 'Обновите список, чтобы проверить отзыв.'); }
    finally { busy.current=false;if(live())setLoading(false); }
  }
  async function remove(target: FamilyMember) {
    if(!live() || busy.current || !owner || target.role==='owner' || target.user_id===userId || confirmed.current?.id!==target.id) return;
    busy.current=true;setLoading(true);setError(null);
    try {
      await removeFamilyMember(userId,familyId,target.id);
      const access=await getFamilyAccess(userId,familyId);if(live()){setData(access);confirmed.current=null;setConfirmation(null);}
    } catch(e) { if(live()){confirmed.current=null;setConfirmation(null);setError(e instanceof Error ? e.message : 'Обновите список, чтобы проверить доступ.');} }
    finally { busy.current=false;if(live())setLoading(false); }
  }
  return <FamilyFormScreen title="Участники семьи" onBack={()=>{if(live()&&!busy.current)router.back();}}>
    <Text style={s.hint}>У каждого родственника — свой аккаунт. Участник видит семейный альбом и добавляет свои воспоминания; владелец управляет доступом.</Text>
    {error ? <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
    {data?.members.map(m=><View key={m.id} style={s.card}><Text style={s.label}>{m.name?.trim() || (m.user_id===userId ? 'Вы' : 'Участник семьи')}</Text>
      <Text style={s.hint}>{m.role==='owner' ? 'Владелец' : 'Участник'}{m.user_id===userId ? ' · это вы' : ''}</Text>
      {owner && m.role!=='owner' && m.user_id!==userId ? <FormButton label="Отозвать доступ" danger disabled={loading} onPress={()=>{if(live()&&!busy.current){confirmed.current=m;setConfirmation(m);}}} /> : null}
    </View>)}
    {confirmation ? <View style={s.card}><Text style={s.hint}>Отозвать доступ у {confirmation.name?.trim() || 'участника'}? Его аккаунт, воспоминания и файлы останутся. Уже выданная ссылка на файл может работать до истечения срока.</Text>
      <FormButton label="Подтвердить отзыв доступа" disabled={loading} danger onPress={()=>void remove(confirmation)} />
      <FormButton label="Отмена" disabled={loading} onPress={()=>{if(live()&&!busy.current){confirmed.current=null;setConfirmation(null);}}} /></View> : null}
    {owner ? <>
      <Text style={s.label}>Приглашения</Text><Text style={s.hint}>Один код — для одного родственника, на 7 дней. Пересылайте только тому, кому доверяете доступ к семейному альбому.</Text>
      <FormButton primary label={draft ? 'Проверить прежнее приглашение' : 'Создать приглашение'} disabled={loading || broken || !valid} onPress={()=>void invite()} />
      {shareCode ? <View style={s.card}><Text selectable style={s.hint}>{`moyaistoriya://family/join?code=${shareCode}`}</Text>
        <Text selectable style={s.hint}>{shareCode}</Text>
        <FormButton label="Поделиться приглашением" disabled={loading} onPress={()=>{if(live()&&!busy.current)void Share.share({message:`Присоединяйся к нашей семье в «Моей истории».\nmoyaistoriya://family/join?code=${shareCode}\nЕсли ссылка не открывается, вставь код в «Принять приглашение»:\n${shareCode}`}).catch(()=>{if(live())setError('Не удалось открыть отправку. Можно скопировать код.');});}} />
        <FormButton label="Создать код для другого родственника" disabled={loading} onPress={()=>{if(!live()||busy.current)return;try{clearOperation(key);pending.current=null;setDraft(null);setShareCode(null);}catch{setError('Не удалось сохранить локальные изменения.');}}} /></View> : null}
      {data?.invitations.map(i=><View key={i.id} style={s.card}><Text style={s.hint}>{i.accepted_at ? 'Принято' : i.revoked_at ? 'Отозвано' : Date.parse(i.expires_at)<=Date.now() ? 'Истекло' : `Действует до ${new Date(i.expires_at).toLocaleDateString('ru-RU')}`}</Text>
        {!i.accepted_at && !i.revoked_at && Date.parse(i.expires_at)>Date.now() ? <FormButton label="Отозвать приглашение" disabled={loading} onPress={()=>void revoke(i.id)} /> : null}</View>)}
    </> : null}
    <FormButton label="Принять приглашение в другую семью" disabled={loading} onPress={()=>{if(live()&&!busy.current)router.push('/family/join');}} />
    <FormButton label="Обновить участников" disabled={loading} onPress={()=>void load()} />
  </FamilyFormScreen>;
}
