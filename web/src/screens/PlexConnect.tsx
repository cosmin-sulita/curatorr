import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import { Button, Field, inputClass, Notice, Spinner } from '../components/ui';
import { api, errorMessage, type PlexServerOption, type ServerLibrary } from '../lib/api';
import { usePlexSignIn } from '../lib/plexAuth';
import { LibraryPicker, UserImport } from './MediaServer';

type Stage = 'signin' | 'server' | 'libraries' | 'users';

/** Sign in with Plex → pick server → pick libraries → import Plex Home users. */
export function PlexConnect({ signedIn, onDone }: { signedIn: boolean; onDone: () => void }) {
  const [stage, setStage] = useState<Stage>(signedIn ? 'server' : 'signin');
  const [libraries, setLibraries] = useState<ServerLibrary[]>([]);
  const signIn = usePlexSignIn('setup', () => setStage('server'));

  if (stage === 'signin') {
    return (
      <div className="space-y-4">
        <p className="text-muted">
          Curatorr uses Plex to know who has watched what, and to open a pick straight in Plex. Sign in with the account that
          owns your Plex server.
        </p>
        <Button variant="primary" size="lg" onClick={signIn.start} loading={signIn.waiting}>
          {signIn.waiting ? 'Waiting for Plex…' : 'Sign in with Plex'}
        </Button>
        {signIn.manualUrl && (
          <Notice tone="info">
            Your browser blocked the sign-in window.{' '}
            <a className="font-semibold underline" href={signIn.manualUrl} target="_blank" rel="noreferrer">
              Open Plex sign-in
            </a>{' '}
            and come back here when you're done.
          </Notice>
        )}
        {signIn.error && <Notice>{signIn.error}</Notice>}
      </div>
    );
  }

  if (stage === 'server') {
    return (
      <ServerPicker
        onPicked={(libs) => {
          setLibraries(libs);
          setStage('libraries');
        }}
        onSignInAgain={() => setStage('signin')}
      />
    );
  }

  if (stage === 'libraries') {
    return (
      <LibraryPicker
        libraries={libraries}
        onSave={(sectionIds) => api('/api/setup/plex/libraries', { json: { sectionIds } })}
        onSaved={() => setStage('users')}
        onBack={() => setStage('server')}
        backLabel="Choose another server"
      />
    );
  }

  return <UserImport server="plex" onDone={onDone} />;
}

function ServerPicker({ onPicked, onSignInAgain }: { onPicked: (libs: ServerLibrary[]) => void; onSignInAgain: () => void }) {
  const servers = useQuery({
    queryKey: ['plex-servers'],
    queryFn: () => api<PlexServerOption[]>('/api/setup/plex/servers'),
    staleTime: 0,
  });
  const [choice, setChoice] = useState<{ machineId: string; url: string; name: string } | null>(null);
  const [manual, setManual] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstOk = servers.data?.flatMap((s) => s.connections.filter((c) => c.ok).map((c) => ({ ...c, server: s })))[0];
  const selected =
    choice ?? (firstOk ? { machineId: firstOk.server.machineId, url: firstOk.url, name: firstOk.server.name } : null);

  const save = async () => {
    const target = manual.trim() && selected ? { ...selected, url: manual.trim() } : selected;
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ libraries: ServerLibrary[] }>('/api/setup/plex/server', { json: target });
      onPicked(res.libraries);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (servers.isLoading) {
    return (
      <div className="flex items-center gap-3 text-muted">
        <Spinner className="size-5" /> Looking for your Plex servers and testing how to reach them…
      </div>
    );
  }
  if (servers.error) {
    return (
      <div className="space-y-3">
        <Notice>{errorMessage(servers.error)}</Notice>
        <Button onClick={onSignInAgain}>Sign in again</Button>
      </div>
    );
  }
  if (!servers.data?.length) {
    return (
      <div className="space-y-3">
        <Notice>This Plex account doesn't own any servers.</Notice>
        <Button onClick={onSignInAgain}>Sign in again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-muted">Choose the server Curatorr should read from. Addresses that answered are marked.</p>
      {servers.data.map((s) => (
        // A fieldset is as wide as its longest line unless told otherwise: without min-w-0, a plex.direct address
        // pushes it past the card on a phone instead of being shortened.
        <fieldset key={s.machineId} className="min-w-0 rounded-2xl bg-ink/60 p-4 ring-1 ring-line">
          <legend className="px-1 font-semibold">{s.name}</legend>
          <div className="mt-1 space-y-1">
            {s.connections.map((c) => {
              const active = selected?.machineId === s.machineId && selected.url === c.url && !manual;
              return (
                <label
                  key={c.url}
                  className={clsx(
                    'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                    active ? 'bg-accent/15 ring-1 ring-accent/50' : 'hover:bg-white/5',
                  )}
                >
                  <input
                    type="radio"
                    name="plex-connection"
                    className="accent-indigo-500"
                    checked={active}
                    onChange={() => {
                      setManual('');
                      setChoice({ machineId: s.machineId, url: c.url, name: s.name });
                    }}
                  />
                  <span className={clsx('size-2 shrink-0 rounded-full', c.ok ? 'bg-emerald-400' : 'bg-faint')} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{c.url}</span>
                  <span className="shrink-0 text-xs text-faint">
                    {c.ok ? `${c.ms} ms` : 'no answer'}
                    {c.local ? ', local' : c.relay ? ', relay' : ''}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <Field label="Or enter an address" hint="For example http://192.168.1.10:32400 when Plex runs on the same NAS.">
        <input className={inputClass} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="http://" />
      </Field>
      {error && <Notice>{error}</Notice>}
      <Button variant="primary" size="lg" onClick={save} loading={saving} disabled={!selected}>
        Use this server
      </Button>
    </div>
  );
}

/** The server owner signs in with Plex to manage Curatorr on this device; everything reloads as the owner. */
export function OwnerSignIn() {
  const qc = useQueryClient();
  const signIn = usePlexSignIn('login', () => qc.invalidateQueries());
  return (
    <>
      <Button variant="primary" onClick={signIn.start} loading={signIn.waiting}>
        {signIn.waiting ? 'Waiting for Plex…' : 'Sign in with Plex'}
      </Button>
      {signIn.manualUrl && (
        <p className="mt-3 text-sm text-muted">
          Pop-up blocked.{' '}
          <a className="font-semibold text-indigo-300 underline" href={signIn.manualUrl} target="_blank" rel="noreferrer">
            Open Plex sign-in
          </a>
        </p>
      )}
      {signIn.error && (
        <div className="mt-3">
          <Notice>{signIn.error}</Notice>
        </div>
      )}
    </>
  );
}
