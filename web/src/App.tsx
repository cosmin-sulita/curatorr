import type { AppStatus } from '@curatorr/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { CenteredState, Frame, Shell, Wordmark } from './components/Shell';
import { Button, Notice, Spinner } from './components/ui';
import { WhatsNew } from './components/WhatsNew';
import { errorMessage, isNetworkError, likeSeedsQuery, profilesQuery, useStatus, wizardQuery } from './lib/api';
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
  const opening = useOpening(path, status.data);
  const offline = useOffline(status);

  if ((status.isLoading && !offline) || opening) return <Launch />;

  // Only when nothing has loaded yet. A later check that fails (say, coming back to the app while
  // Wi-Fi reconnects) leaves the screen as it is, and its own requests say what went wrong.
  if (!status.data) {
    return (
      <Frame bare>
        <Shell>
          <CenteredState title="Can't reach Curatorr">
            {/* A server error adds something; a network error would only repeat the title. */}
            {status.error && !isNetworkError(status.error) && <Notice>{errorMessage(status.error)}</Notice>}
            <p className="text-muted">
              Check that the Curatorr container is running and your device is on the right network. Curatorr keeps
              trying, and opens as soon as it answers.
            </p>
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

/** While Curatorr can't be reached, the app tries again this often, as well as on coming back to the foreground. */
const RETRY_OFFLINE_MS = 10_000;

/**
 * True once the status has failed with nothing loaded: Curatorr can't be reached, away from home say. The screen that
 * says so stays up while the app keeps trying, instead of each try bringing back the launch screen, and the app opens
 * once Curatorr answers. Coming back to the foreground or onto a network tries at once (the status query does that).
 */
function useOffline(status: ReturnType<typeof useStatus>) {
  const [offline, setOffline] = useState(false);
  const { data, isError, refetch } = status;
  useEffect(() => {
    if (data) setOffline(false);
    else if (isError) setOffline(true);
  }, [data, isError]);
  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refetch({ cancelRefetch: false });
    }, RETRY_OFFLINE_MS);
    return () => clearInterval(timer);
  }, [offline, refetch]);
  return offline;
}

/** What shows while the app opens. The spinner only comes after a moment: a quick launch shows the wordmark alone. */
function Launch() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-6">
        <Wordmark className="scale-125" />
        {/* Its room is kept, so the wordmark doesn't move when it comes. */}
        {slow ? <Spinner /> : <span className="size-6" aria-hidden />}
      </div>
    </div>
  );
}

/**
 * At launch, the app stays on the launch screen until its first screen has what it shows (loaded alongside the
 * status, see loadFirstScreen): the first question with the "Something like…" posters, or "Who's watching?" with the
 * profiles. So it opens once, whole, instead of showing the header with a spinner of its own. Later screens load as
 * they always do.
 */
function useOpening(path: string, status: AppStatus | undefined) {
  const [opened, setOpened] = useState(false);
  // Without a profile every address but Settings shows "Who's watching?"; with one, / and /ask/genre show the first
  // question (see screenFor).
  const firstScreen = path !== '/settings' && (!status?.profile || path === '/' || path === '/ask/genre');
  const atStart = !opened && status?.setupComplete === true && firstScreen;
  const question = atStart && Boolean(status?.profile);
  const genre = useQuery({ ...wizardQuery('genre', {}), enabled: question });
  const seeds = useQuery({ ...likeSeedsQuery(''), enabled: question });
  const profiles = useQuery({ ...profilesQuery, enabled: atStart && !status?.profile });
  const waiting = atStart && (question ? genre.isPending || seeds.isPending : profiles.isPending);
  useEffect(() => {
    if (status && !waiting) setOpened(true);
  }, [status, waiting]);
  return waiting;
}

/** The screen for this address, and whether the top bar leaves out Settings and the profile. */
function screenFor(path: string, search: URLSearchParams, s: AppStatus): { screen: ReactNode; bare?: boolean } {
  if (!s.setupComplete) return { screen: <SetupScreen />, bare: true };
  if (path === '/settings') return { screen: <SettingsScreen /> };
  if (!s.profile || path === '/profiles') return { screen: <ProfilesScreen />, bare: true };
  // Each set of picks gets a screen of its own, so "Something like this" from a pick's poster starts afresh.
  if (path === '/pick') return { screen: <PickScreen key={search.toString()} search={search} /> };
  if (path === '/like') return { screen: <LikeScreen search={search} /> };
  // The profile's lists, opened from Settings.
  const list = /^\/settings\/([a-z]+)$/.exec(path)?.[1];
  if (isMarkList(list)) return { screen: <MarksScreen list={list} /> };

  const step = /^\/ask\/([a-z]+)$/.exec(path)?.[1];
  if (isStep(step)) return { screen: <WizardScreen step={step} search={search} /> };
  return { screen: <WizardScreen step="genre" search={new URLSearchParams()} /> };
}
