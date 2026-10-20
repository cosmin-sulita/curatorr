import type { MediaServer, Profile } from '@curatorr/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Lock } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Button, Notice, Spinner } from '../components/ui';
import { api, errorMessage, type ServerLibrary } from '../lib/api';

// Setting up Plex and Jellyfin ends the same way: their movie libraries, then their users as profiles.

/** Choose the libraries that hold the Radarr movies: the ones chosen before, or all of them to start with. */
export function LibraryPicker({
  libraries,
  initial,
  onSave,
  onSaved,
  onBack,
  backLabel,
}: {
  libraries: ServerLibrary[];
  /** The libraries chosen before, when changing the connection. With none of them on this server, all are ticked. */
  initial?: string[];
  onSave: (keys: string[]) => Promise<unknown>;
  onSaved: () => void;
  onBack: () => void;
  backLabel: string;
}) {
  const [selected, setSelected] = useState(() => {
    const kept = libraries.filter((l) => initial?.includes(l.key));
    return new Set((kept.length ? kept : libraries).map((l) => l.key));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave([...selected]);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!libraries.length) {
    return (
      <div className="space-y-3">
        <Notice>No movie libraries were found on this server.</Notice>
        <Button onClick={onBack}>{backLabel}</Button>
      </div>
    );
  }

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

/** Turns the media server's users into profiles, and shows who became one. */
export function UserImport({ server, onDone }: { server: MediaServer; onDone: () => void }) {
  const users = useQuery({
    queryKey: ['server-import', server],
    queryFn: () => api<(Profile & { hidden: boolean })[]>(`/api/setup/${server}/users`, { json: {} }),
    staleTime: Infinity,
    retry: false,
  });
  const who = server === 'plex' ? 'Plex Home' : 'Jellyfin';

  if (users.isLoading) {
    return (
      <div className="flex items-center gap-3 text-muted">
        <Spinner className="size-5" /> Importing {who} users…
      </div>
    );
  }
  if (users.error) {
    return (
      <div className="space-y-3">
        <Notice>{errorMessage(users.error)}</Notice>
        <Button onClick={() => users.refetch()} loading={users.isFetching}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted">These {who} users became profiles. Each one gets picks based on their own watch history.</p>
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
