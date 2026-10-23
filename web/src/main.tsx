import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { ApiError, isNetworkError, isTimeout, loadFirstScreen } from './lib/api';
import { startUpdateChecks } from './lib/appUpdate';
import { listenForInstallPrompt } from './lib/install';
import './styles.css';

startUpdateChecks();
listenForInstallPrompt();

// The service worker's pictures from before they loaded with CORS: opaque copies that a CORS request can't use, under
// the old name (see vite.config.ts). Plain HTTP has no `caches`.
try {
  window.caches?.delete('tmdb-images').catch(() => {});
} catch {
  // Storage blocked: there's nothing to delete.
}

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    // Curatorr lives on the home network, so "browser offline" says nothing about whether it's reachable: always try.
    // A request that went unanswered isn't asked again at once: it would only make the wait longer.
    queries: {
      networkMode: 'always',
      retry: (count, err) => isNetworkError(err) && !isTimeout(err) && count < 2,
      refetchOnWindowFocus: false,
    },
    mutations: { networkMode: 'always' },
  },
  queryCache: new QueryCache({
    onError: (err) => {
      // The profile cookie expired or the profile was removed: go back to "Who's watching?".
      if (err instanceof ApiError && (err.data.needProfile || err.data.needSetup)) {
        queryClient.invalidateQueries({ queryKey: ['status'] });
      }
    },
  }),
});

// The first screen loads alongside the status, so the app opens on it in one go.
loadFirstScreen(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <App />
        </ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
