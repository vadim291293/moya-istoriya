import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { FamilyFormScreen, FormButton, familyFormStyles as s } from '../../components/family-form-ui';
import { useFamilyFormScope } from '../../components/use-family-form-scope';
import { getFamilyTrash, setMemoryArchived, validateLifecycleAttempt, FamilyOperationError, type TrashMemory, type LifecycleAttempt } from '../../lib/family-access-service';
import { operationKey, readOperation, writeOperation, clearOperation } from '../../lib/family-operation-journal';
import { formatRuDate } from '../../lib/date-utils';

export default function FamilyTrashScreen() {
  const router=useRouter();const {auth,live,focused}=useFamilyFormScope();
  const userId=auth.session?.user.id ?? '';const familyId=auth.family.status==='ready' ? auth.family.family.id : '';
  const busy=useRef(false);const generation=useRef(0);const [loading,setLoading]=useState(true);const [items,setItems]=useState<TrashMemory[]>([]);
  const latest=useRef(items);latest.current=items;const [more,setMore]=useState(false);const [error,setError]=useState<string | null>(null);
  const [confirmation,setConfirmation]=useState<TrashMemory | null>(null);
  const confirmed=useRef(confirmation);confirmed.current=confirmation;
  async function load(append=false) {
    if(!live()||busy.current)return;busy.current=true;setLoading(true);setError(null);const version=++generation.current;
    try {
      const last=append ? latest.current.at(-1) : undefined;
      const page=await getFamilyTrash(userId,familyId,last ? {id:last.id,deleted_at:last.deleted_at} : undefined);
      if(live()&&generation.current===version){setItems(previous=>append ? [...previous,...page.items.filter(row=>!previous.some(v=>v.id===row.id))] : page.items);setMore(page.hasMore);}
    }catch(e){if(live())setError(e instanceof Error ? e.message : 'Не удалось открыть корзину.');}
    finally{busy.current=false;if(live())setLoading(false);}
  }
  useEffect(()=>{if(focused)void load();},[focused]);
  async function restore(row: TrashMemory) {
    if(!live()||busy.current||confirmed.current?.id!==row.id)return;busy.current=true;setLoading(true);setError(null);
    const key=operationKey('lifecycle',userId,familyId,row.id);
    try {
      const raw=readOperation(key);const old=raw ? validateLifecycleAttempt(raw as LifecycleAttempt) : null;
      if(old && (old.userId!==userId||old.familyId!==familyId||old.memoryId!==row.id))throw new Error('Незавершённая операция принадлежит другой записи.');
      if(old?.archived)throw new Error('Сначала завершите прежний перенос в корзину через экран воспоминания.');
      const request=old ?? {userId,familyId,memoryId:row.id,expectedVersion:row.state_version,archived:false,operationId:Crypto.randomUUID()};
      writeOperation(key,request);await setMemoryArchived(request);
      try{clearOperation(key);}catch{/* A server receipt makes a later retry safe. */}
      if(live()){setItems(previous=>previous.filter(v=>v.id!==row.id));confirmed.current=null;setConfirmation(null);}
    }catch(e){if(live()){
      setError(e instanceof Error ? e.message : 'Результат пока не подтверждён. Повторите то же восстановление.');
      if(e instanceof FamilyOperationError && ['conflict','invalid','forbidden'].includes(e.kind)){try{clearOperation(key);}catch{}confirmed.current=null;setConfirmation(null);}
    }}finally{busy.current=false;if(live())setLoading(false);}
  }
  return <FamilyFormScreen title="Корзина" onBack={()=>{if(live()&&!busy.current)router.back();}}>
    <Text style={s.hint}>Записи скрыты из альбома, но фото и видео сохранены. Автоматического или безвозвратного удаления сейчас нет. Это защита от случайного удаления, а не резервная копия.</Text>
    {error ? <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text> : null}
    {!loading && items.length===0 ? <Text style={s.label}>Корзина пуста</Text> : null}
    {items.map(row=><View key={row.id} style={s.card}><Text style={s.label}>{row.title || 'Воспоминание'}</Text><Text style={s.hint}>{formatRuDate(row.event_date)} · файлов: {row.media_count}</Text>
      <FormButton label="Восстановить" disabled={loading} onPress={()=>{if(live()&&!busy.current){confirmed.current=row;setConfirmation(row);}}} />
      <FormButton label="Проверить незавершённое действие" disabled={loading} onPress={()=>{if(live()&&!busy.current)router.push({pathname:'/memory/[id]',params:{id:row.id}});}} />
    </View>)}
    {confirmation ? <View style={s.card}><Text style={s.hint}>Вернуть «{confirmation.title || 'Воспоминание'}» и его файлы в альбом?</Text>
      <FormButton primary label="Подтвердить восстановление" disabled={loading} onPress={()=>void restore(confirmation)} />
      <FormButton label="Отмена" disabled={loading} onPress={()=>{if(live()&&!busy.current){confirmed.current=null;setConfirmation(null);}}} /></View> : null}
    {more ? <FormButton label="Показать ещё" disabled={loading} onPress={()=>void load(true)} /> : null}
    <FormButton label="Обновить корзину" disabled={loading} onPress={()=>void load()} />
  </FamilyFormScreen>;
}
