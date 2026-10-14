import { Alert } from 'react-native';
import { AppStatusScreen } from '../components/app-status-screen';
import { useAuth } from '../lib/auth-context';

export default function SessionStatusScreen() {
  const { isInitializing, authError, family, refreshFamily, signOut, retrySession } = useAuth();
  if (isInitializing) {
    return <AppStatusScreen loading title="Открываем вашу историю" message="Восстанавливаем вход в аккаунт." />;
  }
  if (authError) {
    return <AppStatusScreen title="Не удалось восстановить вход" message={authError}
      primaryLabel="Попробовать ещё раз" onPrimaryPress={() => void retrySession()} />;
  }
  if (family.status === 'error') {
    return <AppStatusScreen title="Не удалось загрузить семейную историю" message={family.message}
      primaryLabel="Повторить" onPrimaryPress={() => void refreshFamily()}
      secondaryLabel="Выйти из аккаунта" onSecondaryPress={() => {
        void signOut().then((error) => {
          if (error) Alert.alert('Не удалось выйти', 'Проверьте подключение и попробуйте ещё раз.');
        });
      }} />;
  }
  return <AppStatusScreen loading title="Загружаем семейную историю" message="Получаем данные семьи и детей." />;
}
