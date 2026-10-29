import { useEffect, useRef, useState } from 'react';
import type { PlexPinClaim, PlexPinStarted } from '@curatorr/shared';
import { api, errorMessage } from './api';

const POLL_MS = 1500;
const TIMEOUT_MS = 5 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plex's PIN sign-in: open app.plex.tv in a popup, then poll until the user approves.
 * The popup is opened synchronously on click so browsers don't block it. Closing it tells Curatorr nothing, so
 * `cancel` stops waiting; otherwise a window closed without signing in holds the button until the timeout.
 */
export function usePlexSignIn(purpose: 'setup' | 'login', onDone: (account: PlexPinClaim['account']) => void) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  // The sign-in under way: one that was cancelled, started again or left behind stops at its next step.
  const run = useRef(0);
  const popup = useRef<Window | null>(null);

  useEffect(
    () => () => {
      // Leaving the step doesn't leave Plex's window open.
      run.current++;
      popup.current?.close();
    },
    [],
  );

  const start = async () => {
    const id = ++run.current;
    const current = () => run.current === id;
    const win = window.open('', 'plex-auth', 'width=600,height=720');
    popup.current = win;
    setWaiting(true);
    setError(null);
    setManualUrl(null);
    try {
      const pin = await api<PlexPinStarted>('/api/plex/pin', { json: {} });
      if (!current()) return;
      if (win && !win.closed) win.location.href = pin.authUrl;
      else setManualUrl(pin.authUrl);

      const deadline = Date.now() + TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        if (!current()) return;
        const res = await api<PlexPinClaim>(`/api/plex/pin/${pin.id}/claim`, { json: { purpose } });
        if (!current()) return;
        if (res.status === 'ok') {
          win?.close();
          setWaiting(false);
          setManualUrl(null);
          onDone(res.account);
          return;
        }
      }
      throw new Error('Plex sign-in timed out. Try again.');
    } catch (err) {
      if (!current()) return;
      win?.close();
      setWaiting(false);
      setError(errorMessage(err));
    }
  };

  const cancel = () => {
    run.current++;
    popup.current?.close();
    setWaiting(false);
    setManualUrl(null);
    setError(null);
  };

  return { start, cancel, waiting, error, manualUrl };
}
