import type { Profile } from '@curatorr/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Lock } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Button, Field, inputClass, Notice, Spinner } from '../components/ui';
import { api, errorMessage, type PlexLibrary, type PlexServerOption } from '../lib/api';
import { usePlexSignIn } from '../lib/plexAuth';

type Stage = 'signin' | 'server' | 'libraries' | 'users';

/** Sign in with Plex → pick server → pick libraries → import Plex Home users. */
export function PlexConnect({
  signedIn,
  onDone,
  onSkip,
}: {
  signedIn: boolean;
  onDone: () => void;
  onSkip?: () => void;
}) {
  const [stage, setStage] = useState<Stage>(signedIn ? 'server' : 'signin');
  const [libraries, setLibraries] = useState<PlexLibrary[]>([]);
  const signIn = usePlexSignIn('setup', () => setStage('server'));

  if (stage === 'signin') {
    return (
      <div className="space-y-4">
        <p className="text-muted">
          Curatorr uses Plex to know who has watched what, and to open a pick straight in Plex. Sign in with the account that
          owns your Plex server.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="lg" onClick={signIn.start} loading={signIn.waiting}>
            {signIn.waiting ? 'Waiting for Plex…' : 'Sign in with Plex'}
          </Button>
          {onSkip && (
            <Button variant="ghost" size="lg" onClick={onSkip}>
              Skip, I don't use Plex
            </Button>
          )}
        </div>
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
    return <LibraryPicker libraries={libraries} onSaved={() => setStage('users')} />;
  }

  return <UserImport onDone={onDone} />;
}

function ServerPicker({ onPicked, onSignInAgain }: { onPicked: (libs: PlexLibrary[]) => void; onSignInAgain: () => void }) {
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
      const res = await api<{ libraries: PlexLibrary[] }>('/api/setup/plex/server', { json: target });
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
    return <Notice>This Plex account doesn't own any servers.</Notice>;
  }

  return (
    <div className="space-y-5">
      <p className="text-muted">Choose the server Curatorr should read from. Addresses that answered are marked.</p>
      {servers.data.map((s) => (
        <fieldset key={s.machineId} className="rounded-2xl bg-ink/60 p-4 ring-1 ring-line">
          <legend className="px-1 font-semibold">{s.name}</legend>
          <div className="mt-1 space-y-1">
            {s.connections.map((c) => {
              const active = selected?.machineId === s.machineId && selected.url === c.url && !manual;
              return (
                <label
                  key={c.url}
                  className={clsx(
                    'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
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

function LibraryPicker({ libraries, onSaved }: { libraries: PlexLibrary[]; onSaved: () => void }) {
  const [selected, setSelected] = useState(() => new Set(libraries.map((l) => l.key)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('/api/setup/plex/libraries', { json: { sectionIds: [...selected] } });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!libraries.length) return <Notice>No movie libraries were found on this server.</Notice>;

  return (
    <div className="space-y-4">
      <p className="text-muted">Which movie libraries hold your Radarr movies?</p>
      <div className="space-y-2">
        {libraries.map((l) => (
          <label key={l.key} className="flex cursor-pointer items-center gap-3 rounded-xl bg-ink/60 px-4 py-3 ring-1 ring-line">
            <input
              type="checkbox"
              className="size-4 accent-indigo-500"
              checked={selected.has(l.key)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(l.key);
                else next.delete(l.key);
                setSelected(next);
              }}
            />
            {l.title}
          </label>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      <Button variant="primary" size="lg" onClick={save} loading={saving} disabled={selected.size === 0}>
        Continue
      </Button>
    </div>
  );
}

function UserImport({ onDone }: { onDone: () => void }) {
  const users = useQuery({
    queryKey: ['plex-import'],
    queryFn: () => api<(Profile & { hidden: boolean })[]>('/api/setup/plex/users', { json: {} }),
    staleTime: Infinity,
    retry: false,
  });

  if (users.isLoading) {
    return (
      <div className="flex items-center gap-3 text-muted">
        <Spinner className="size-5" /> Importing Plex Home users…
      </div>
    );
  }
  if (users.error) return <Notice>{errorMessage(users.error)}</Notice>;

  return (
    <div className="space-y-4">
      <p className="text-muted">These Plex Home users became profiles. Each one gets picks based on their own watch history.</p>
      <ul className="space-y-2">
        {users.data?.map((u) => (
          <li key={u.id} className="flex items-center gap-3 rounded-xl bg-ink/60 px-4 py-3 ring-1 ring-line">
            <Avatar name={u.name} src={u.avatarUrl} className="size-9" />
            <span className="flex-1 font-medium">{u.name}</span>
            {u.linked ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                <Check className="size-3.5" /> Ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Lock className="size-3.5" /> Asks for PIN once
              </span>
            )}
          </li>
        ))}
      </ul>
      <Button variant="primary" size="lg" onClick={onDone}>
        Continue
      </Button>
    </div>
  );
}
