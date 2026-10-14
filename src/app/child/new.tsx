import { NewChildForm } from '../../components/new-child-form';
import { useAuth } from '../../lib/auth-context';

export default function NewChildScreen() {
  const { session, family } = useAuth();
  if (!session || family.status !== 'ready') return null;
  return <NewChildForm key={`${session.user.id}:${family.family.id}`}
    userId={session.user.id} familyId={family.family.id} familyName={family.family.name} />;
}
