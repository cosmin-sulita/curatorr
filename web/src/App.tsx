import type { AppStatus } from '@curatorr/shared';
import type { ReactNode } from 'react';
import { CenteredState, Frame, Shell, Wordmark } from './components/Shell';
import { Button, Notice, Spinner } from './components/ui';
import { WhatsNew } from './components/WhatsNew';
import { errorMessage, isNetworkError, useStatus } from './lib/api';
import { useLocation } from './lib/router';
import { isStep } from './lib/wizard';
import { LikeScreen } from './screens/Like';
import { isMarkList, MarksScreen } from './screens/Marks';
import { PickScreen } from './screens/Pick';
import { ProfilesScreen } from './screens/Profiles';
import { SettingsScreen } from './screens/Settings';
import { SetupScreen } from './screens/Setup';
import { WizardScreen } from './screens/Wizard';

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

  // Only when nothing has loaded yet. A later check that fails (say, coming back to the app while
  // Wi-Fi reconnects) leaves the screen as it is, and its own requests say what went wrong.
  if (!status.data) {
    return (
      <Frame bare>
        <Shell>
          <CenteredState title="Can't reach Curatorr">
            {/* A server error adds something; a network error would only repeat the title. */}
            {status.error && !isNetworkError(status.error) && <Notice>{errorMessage(status.error)}</Notice>}
            <p className="text-muted">Check that the Curatorr container is running and your device is on the right network.</p>
            <Button onClick={() => status.refetch()} loading={status.isFetching}>
              Try again
            </Button>
          </CenteredState>
        </Shell>
      </Frame>
    );
  }

  const { screen, bare } = screenFor(path, search, status.data);
  return (
    <>
      <Frame bare={bare}>{screen}</Frame>
      <WhatsNew setupComplete={status.data.setupComplete} />
    </>
  );
}

/** The screen for this address, and whether the top bar leaves out Settings and the profile. */
function screenFor(path: string, search: URLSearchParams, s: AppStatus): { screen: ReactNode; bare?: boolean } {
  if (!s.setupComplete) return { screen: <SetupScreen />, bare: true };
  if (path === '/settings') return { screen: <SettingsScreen /> };
  if (!s.profile || path === '/profiles') return { screen: <ProfilesScreen />, bare: true };
  if (path === '/pick') return { screen: <PickScreen search={search} /> };
  if (path === '/like') return { screen: <LikeScreen search={search} /> };
  // The profile's lists, opened from Settings.
  const list = /^\/settings\/([a-z]+)$/.exec(path)?.[1];
  if (isMarkList(list)) return { screen: <MarksScreen list={list} /> };

  const step = /^\/ask\/([a-z]+)$/.exec(path)?.[1];
  if (isStep(step)) return { screen: <WizardScreen step={step} search={search} /> };
  return { screen: <WizardScreen step="genre" search={new URLSearchParams()} /> };
}
