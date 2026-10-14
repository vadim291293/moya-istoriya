import { useEffect, useRef, useState } from 'react';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { Text, TextInput } from 'react-native';
import { useAuth } from '../../lib/auth-context';
import { invitationCode, acceptInvitation, FamilyOperationError } from '../../lib/family-access-service';
import { operationKey, readOperation, writeOperation, clearOperation } from '../../lib/family-operation-journal';
import { FamilyFormScreen, FormButton, familyFormStyles as s } from '../../components/family-form-ui';

const PENDING_LINK='moya-istoriya:pending-invitation:v1';
export default function JoinFamilyScreen() {
  const auth=useAuth();const params=useLocalSearchParams<{code?:string}>();
  const incoming=Array.isArray(params.code) ? params.code[0] : params.code;
  return <JoinForm key={`${auth.session?.user.id ?? 'guest'}:${incoming ?? ''}`} incoming={incoming} />;
}
export function JoinForm({incoming}: {incoming?:string}) {
  const router=useRouter();const auth=useAuth();const focused=useIsFocused();
  const initial=useRef(auth.session?.user.id ?? null);const actor=useRef(auth.session?.user.id ?? null);actor.current=auth.session?.user.id ?? null;
  const mounted=useRef(true);const focus=useRef(focused);focus.current=focused;const busy=useRef(false);
  const recovery=useRef(auth.isPasswordRecovery);recovery.current=auth.isPasswordRecovery;
  const key=operationKey('join',initial.current ?? '', '');
  const [restored]=useState(()=>{
    try {
      const saved=initial.current ? readOperation(key) as {userId:string;token:string} | null : null;
      if(saved && saved.userId!==initial.current)throw new Error('Сохранённое принятие принадлежит другому аккаунту.');
      const pending=saved ? invitationCode(saved.token) : null;
      return {code:pending ?? incoming ?? (typeof localStorage==='undefined' ? '' : localStorage.getItem(PENDING_LINK) ?? ''),pending,error:null as string | null};
    }catch{return {code:incoming ?? '',pending:null,error:'Не удалось прочитать сохранённое приглашение. Закройте экран и попробуйте снова.'};}
  });
  const pending=useRef(restored.pending);const [pendingCode,setPendingCode]=useState(restored.pending);
  const [code,setCode]=useState(restored.code);
  const codeRef=useRef(code);codeRef.current=code;
  const [loading,setLoading]=useState(false);const [error,setError]=useState<string | null>(restored.error);const [joined,setJoined]=useState(false);
  const live=()=>mounted.current && focus.current && actor.current===initial.current && !recovery.current;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  function persist() { const value=invitationCode(codeRef.current);if(typeof localStorage==='undefined')throw new Error('Не удалось сохранить приглашение на устройстве.');localStorage.setItem(PENDING_LINK,value);return value; }
  function openLogin(register=false) {
    if(!live()||busy.current||restored.error)return;
    try{persist();router.push(register ? '/register' : '/login');}catch(e){setError(e instanceof Error ? e.message : 'Проверьте код.');}
  }
  async function join() {
    if(!live()||busy.current||!initial.current||restored.error)return;busy.current=true;setLoading(true);setError(null);
    try {
      const value=pending.current ?? persist();
      writeOperation(key,{userId:initial.current,token:value});pending.current=value;setPendingCode(value);
      await acceptInvitation(initial.current,value);
      if(!live())return;
      try{localStorage.removeItem(PENDING_LINK);}catch{/* Same accepted token is idempotent. */}
      try{clearOperation(key);}catch{/* Replay remains tied to the same user and code. */}
      setJoined(true);await auth.refreshFamily();
    }catch(e){if(live()){
      setError(e instanceof Error ? e.message : 'Ответ пока не получен. Повторите с тем же кодом.');
      if(e instanceof FamilyOperationError && ['invalid','forbidden'].includes(e.kind)){
        try{clearOperation(key);pending.current=null;setPendingCode(null);}catch{}
      }
    }}
    finally{busy.current=false;if(live())setLoading(false);}
  }
  return <FamilyFormScreen title="Принять приглашение" onBack={()=>{if(live()&&!busy.current)router.back();}}>
    <Text style={s.hint}>Вставьте код или ссылку владельца семьи. Семейные фотографии не открываются, пока вы не войдёте и не примете приглашение.</Text>
    {error ? <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
    {auth.isPasswordRecovery ? <Text style={s.hint}>Сначала завершите восстановление входа.</Text> : joined ? <>
      <Text style={s.label}>Приглашение принято</Text><Text style={s.hint}>Если семей несколько, приложение предложит выбрать нужную.</Text>
      <FormButton primary label="Открыть семейный альбом" onPress={()=>{if(live())router.replace('/home');}} />
    </> : <>
      <TextInput accessibilityLabel="Код или ссылка приглашения" style={s.input} multiline value={code} autoCapitalize="none" autoCorrect={false} editable={!loading && !pendingCode && !restored.error}
        onChangeText={value=>{if(live()&&!busy.current&&!pending.current&&!restored.error){codeRef.current=value;setCode(value);}}} />
      {pendingCode ? <Text style={s.hint}>Ответ не подтверждён. Проверим прежний код, не принимая другое приглашение.</Text> : null}
      {auth.session ? <FormButton primary label={pendingCode ? 'Проверить принятие приглашения' : 'Присоединиться к семье'} disabled={loading || Boolean(restored.error)} onPress={()=>void join()} /> : <>
        <FormButton label="Войти для принятия приглашения" onPress={()=>openLogin()} /><FormButton label="Зарегистрироваться" onPress={()=>openLogin(true)} />
        <Text style={s.hint}>После входа выберите «Принять приглашение». Код останется на устройстве.</Text>
      </>}
    </>}
  </FamilyFormScreen>;
}
