import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { ApiError, isNetworkError } from './lib/api';
import { startUpdateChecks } from './lib/appUpdate';
import './styles.css';

startUpdateChecks();

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    // Curatorr lives on the home network, so "browser offline" says nothing about whether it's reachable: always try.
    queries: {
      networkMode: 'always',
      retry: (count, err) => isNetworkError(err) && count < 2,
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
