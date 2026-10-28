import { useCallback, useState } from 'react';
import { errorMessage } from './api';

/**
 * A change a form or button makes: whether it's under way, and what went wrong last time. `run` resolves to whether
 * the change went through, so the caller can carry on; the error is shown by the caller (a Notice, mostly).
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (change: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await change();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
