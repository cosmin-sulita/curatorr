import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Field, inputClass, nextFieldOnEnter, Notice, plainField, urlField } from '../components/ui';
import { api, errorMessage, type ServerLibrary, type SettingsResponse } from '../lib/api';
import { LibraryPicker, UserImport } from './MediaServer';

type Stage = 'connect' | 'libraries' | 'users';

/** Sign in as a Jellyfin administrator → pick libraries → import Jellyfin users. */
export function JellyfinConnect({ saved, onDone }: { saved: SettingsResponse['jellyfin']; onDone: () => void }) {
  const [stage, setStage] = useState<Stage>('connect');
  const [libraries, setLibraries] = useState<ServerLibrary[]>([]);

  if (stage === 'connect') {
    return (
      <ConnectForm
        saved={saved}
        onConnected={(libs) => {
          setLibraries(libs);
          setStage('libraries');
        }}
      />
    );
  }
  if (stage === 'libraries') {
    return (
      <LibraryPicker
        libraries={libraries}
        // Jellyfin's library ids are unique, so another server's never match.
        initial={saved?.libraryIds}
        onSave={(libraryIds) => api('/api/setup/jellyfin/libraries', { json: { libraryIds } })}
        onSaved={() => setStage('users')}
        onBack={() => setStage('connect')}
        backLabel="Change the address"
      />
    );
  }
  return <UserImport server="jellyfin" onDone={onDone} />;
}

function ConnectForm({
  saved,
  onConnected,
}: {
  saved: SettingsResponse['jellyfin'];
  onConnected: (libraries: ServerLibrary[]) => void;
}) {
  const [url, setUrl] = useState(saved?.url ?? '');
  const [username, setUsername] = useState(saved?.ownerName ?? '');
  const [password, setPassword] = useState('');
  const [publicUrl, setPublicUrl] = useState(saved?.publicUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server keeps its sign-in when the password is left empty, for the address it was made at.
  const keepsSignIn = Boolean(saved) && url.trim() === saved?.url;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ libraries: ServerLibrary[] }>('/api/setup/jellyfin', {
        json: { url, username, password: password || undefined, publicUrl },
      });
      onConnected(res.libraries);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-muted">
        Curatorr uses Jellyfin to know who has watched what, and to open a pick straight in it. Sign in as a Jellyfin
        administrator: Curatorr keeps a sign-in of its own, not your password.
      </p>
      <Field label="Jellyfin address" hint="Include the port, and the base URL if you set one.">
        <input
          className={inputClass}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://192.168.1.10:8096"
          {...urlField}
          enterKeyHint="next"
          onKeyDown={nextFieldOnEnter}
          required
        />
      </Field>
      <Field label="Administrator's username">
        <input
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          {...plainField}
          autoComplete="username"
          enterKeyHint="next"
          onKeyDown={nextFieldOnEnter}
          required={!keepsSignIn}
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={keepsSignIn ? 'Signed in. Leave empty to stay signed in' : undefined}
          autoComplete="current-password"
          enterKeyHint="go"
          required={!keepsSignIn}
        />
      </Field>
      <Field
        label="Address people open Jellyfin at"
        hint="Optional. Watch on Jellyfin opens this, like https://jellyfin.example.com. Leave it empty when it's the address above."
      >
        <input
          className={inputClass}
          value={publicUrl}
          onChange={(e) => setPublicUrl(e.target.value)}
          placeholder="https://"
          {...urlField}
          enterKeyHint="go"
        />
      </Field>
      {error && <Notice>{error}</Notice>}
      <Button variant="primary" size="lg" type="submit" loading={saving}>
        Connect Jellyfin
      </Button>
    </form>
  );
}

/** A Jellyfin administrator signs in to manage Curatorr on this device; everything reloads as them. */
export function JellyfinSignIn() {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/jellyfin/login', { json: { username, password } });
      await qc.invalidateQueries();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Username">
        <input
          className={inputClass}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          {...plainField}
          autoComplete="username"
          enterKeyHint="next"
          onKeyDown={nextFieldOnEnter}
          required
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          enterKeyHint="go"
          required
        />
      </Field>
      {error && <Notice>{error}</Notice>}
      <Button variant="primary" type="submit" loading={busy}>
        Sign in with Jellyfin
      </Button>
    </form>
  );
}
