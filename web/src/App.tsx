import { STEP_ORDER, type WizardStep } from '@curatorr/shared';
import { CenteredState, Shell, Wordmark } from './components/Shell';
import { Button, Notice, Spinner } from './components/ui';
import { errorMessage, useStatus } from './lib/api';
import { useLocation } from './lib/router';
import { PickScreen } from './screens/Pick';
import { ProfilesScreen } from './screens/Profiles';
import { SettingsScreen } from './screens/Settings';
import { SetupScreen } from './screens/Setup';
import { WizardScreen } from './screens/Wizard';

const isStep = (s: string | undefined): s is WizardStep => STEP_ORDER.includes(s as WizardStep);

export function App() {
  const { path, search } = useLocation();
  const status = useStatus();

  if (status.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-6">
          <Wordmark className="scale-125" />
          <Spinner />
        </div>
      </div>
    );
  }

  if (status.error || !status.data) {
    return (
      <Shell bare>
        <CenteredState title="Can't reach Curatorr">
          <Notice>{errorMessage(status.error)}</Notice>
          <p className="text-muted">Check that the Curatorr container is running and your device is on the right network.</p>
          <Button onClick={() => status.refetch()} loading={status.isFetching}>
            Try again
          </Button>
        </CenteredState>
      </Shell>
    );
  }

  const s = status.data;
  if (!s.setupComplete) return <SetupScreen />;
  if (path === '/settings') return <SettingsScreen />;
  if (!s.profile || path === '/profiles') return <ProfilesScreen />;
  if (path === '/pick') return <PickScreen search={search} />;

  const step = /^\/ask\/([a-z]+)$/.exec(path)?.[1];
  if (isStep(step)) return <WizardScreen step={step} search={search} />;
  return <WizardScreen step="genre" search={new URLSearchParams()} />;
}
