import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

interface PinResponse {
  id: number;
  code: string;
  authUrl: string;
}

interface ClaimResponse {
  status: 'pending' | 'ok';
  account?: { name: string; thumb: string | null };
}

const POLL_MS = 1500;
const TIMEOUT_MS = 5 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plex's PIN sign-in: open app.plex.tv in a popup, then poll until the user approves.
 * The popup is opened synchronously on click so browsers don't block it.
 */
export function usePlexSignIn(purpose: 'setup' | 'login', onDone: (account: ClaimResponse['account']) => void) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const start = async () => {
    const popup = window.open('', 'plex-auth', 'width=600,height=720');
    setWaiting(true);
    setError(null);
    setManualUrl(null);
    try {
      const pin = await api<PinResponse>('/api/plex/pin', { json: {} });
      if (popup && !popup.closed) popup.location.href = pin.authUrl;
      else setManualUrl(pin.authUrl);

      const deadline = Date.now() + TIMEOUT_MS;
      while (alive.current && Date.now() < deadline) {
        await sleep(POLL_MS);
        const res = await api<ClaimResponse>(`/api/plex/pin/${pin.id}/claim`, { json: { purpose } });
        if (res.status === 'ok') {
          popup?.close();
          if (alive.current) {
            setWaiting(false);
            setManualUrl(null);
            onDone(res.account);
          }
          return;
        }
      }
      throw new Error('Plex sign-in timed out. Try again.');
    } catch (err) {
      popup?.close();
      if (!alive.current) return;
      setWaiting(false);
      setError(errorMessage(err));
    }
  };

  return { start, waiting, error, manualUrl };
}
