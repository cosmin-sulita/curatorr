import type { MediaServer } from '@curatorr/shared';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { BackButton, Shell } from '../components/Shell';
import { Button, Field, inputClass, Notice, Spinner } from '../components/ui';
import { api, ApiError, errorMessage, useSettings, useStatus, type SettingsResponse } from '../lib/api';
import { useDeferUpdates } from '../lib/appUpdate';
import { navigate } from '../lib/router';
import { JellyfinConnect, JellyfinSignIn } from './JellyfinConnect';
import { OwnerSignIn, PlexConnect } from './PlexConnect';

type Step = 'radarr' | 'server' | 'seerr' | 'finish';
const STEPS: { id: Step; label: string }[] = [
  { id: 'radarr', label: 'Radarr' },
  { id: 'server', label: 'Server' },
  { id: 'seerr', label: 'Seerr' },
  { id: 'finish', label: 'Finish' },
];

/** After a reload, setup carries on at the first step still to do. The server is done once its users are profiles. */
function resumeAt(s: SettingsResponse | undefined): Step {
  if (!s?.radarr) return 'radarr';
  if (!s.profiles.some((p) => p.serverUser)) return 'server';
  return s.seerr ? 'finish' : 'seerr';
}

export function SetupScreen() {
  const settings = useSettings(true);
  const { data: status } = useStatus();
  const [step, setStep] = useState<Step | null>(null);
  const current: Step = step ?? resumeAt(settings.data);
  // Once someone has connected Plex or Jellyfin, only their account can carry on, so another device asks for it.
  const ownerOnly = settings.error instanceof ApiError && Boolean(settings.error.data.needAdmin);
  // People leave to copy an API key or sign in to their media server; a reload on their return would lose that.
  useDeferUpdates();

  return (
    <Shell>
      <div className="mx-auto max-w-xl pt-8 sm:pt-14">
        <h1 className="font-display text-5xl sm:text-6xl">Set up Curatorr</h1>
        <p className="mt-3 text-muted">Connect your library once. After that it's just a few taps to tonight's movie.</p>

        <ol className="mt-8 flex gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => {
            const index = STEPS.findIndex((x) => x.id === current);
            return (
              <li key={s.id} className="flex-1">
                <span className={clsx('block h-1 rounded-full', i <= index ? 'bg-accent-gradient' : 'bg-raised')} />
                <span className={clsx('mt-2 block text-sm', i === index ? 'font-semibold text-fg' : 'text-faint')}>{s.label}</span>
              </li>
            );
          })}
        </ol>

        <div className="mt-8 rounded-3xl bg-surface p-5 ring-1 ring-line sm:p-7">
          {settings.isLoading ? (
            <Spinner />
          ) : ownerOnly ? (
            <Panel title="Continue setup">
              {status?.server === 'jellyfin' ? (
                <>
                  <p className="mb-4 text-muted">
                    Setup was started by connecting Jellyfin. Sign in as one of its administrators to carry on here.
                  </p>
                  <JellyfinSignIn />
                </>
              ) : (
                <>
                  <p className="mb-4 text-muted">
                    Setup was started by signing in with Plex. Sign in with the same Plex account to carry on here.
                  </p>
                  <OwnerSignIn />
                </>
              )}
            </Panel>
          ) : current === 'radarr' ? (
            <ServiceForm
              service="Radarr"
              initialUrl={settings.data?.radarr?.url ?? ''}
              hasKey={false}
              onSaved={() => setStep('server')}
            />
          ) : current === 'server' ? (
            <ServerStep
              settings={settings.data}
              onDone={() => setStep('seerr')}
              onSkip={async () => {
                await api('/api/setup/server/skip', { json: {} });
                // No Seerr step: its requests are matched to profiles by Plex or Jellyfin account.
                setStep('finish');
              }}
            />
          ) : current === 'seerr' ? (
            <ServiceForm
              service="Seerr"
              initialUrl={settings.data?.seerr?.url ?? ''}
              hasKey={false}
              intro="Optional. Picks favour movies each person requested in Seerr, once they're downloaded."
              onSaved={() => setStep('finish')}
              onSkip={() => setStep('finish')}
            />
          ) : (
            <Finish />
          )}
        </div>
      </div>
    </Shell>
  );
}

/** Plex or Jellyfin: setup connects one of them, or neither. */
function ServerStep({
  settings,
  onDone,
  onSkip,
}: {
  settings: SettingsResponse | undefined;
  onDone: () => void;
  onSkip: () => Promise<void>;
}) {
  // After a reload, carry on with the server signed in to already.
  const [server, setServer] = useState<MediaServer | null>(settings?.server ?? null);
  const [skipping, setSkipping] = useState(false);

  if (server) {
    const back = { onClick: () => setServer(null), label: 'Back to Plex or Jellyfin' };
    return server === 'plex' ? (
      <Panel title="Connect Plex" back={back}>
        <PlexConnect signedIn={Boolean(settings?.plex.signedIn)} saved={settings?.plex} onDone={onDone} />
      </Panel>
    ) : (
      <Panel title="Connect Jellyfin" back={back}>
        <JellyfinConnect saved={settings?.jellyfin ?? null} onDone={onDone} />
      </Panel>
    );
  }

  return (
    <Panel title="Plex or Jellyfin?">
      <p className="mb-4 text-muted">
        Curatorr reads who has watched what from your media server, and each of its users gets a profile.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <ServerOption name="Plex" onClick={() => setServer('plex')}>
          Sign in with the account that owns your Plex server. Plex Home users become profiles.
        </ServerOption>
        <ServerOption name="Jellyfin" onClick={() => setServer('jellyfin')}>
          Sign in as a Jellyfin administrator. Its users become profiles.
        </ServerOption>
      </div>
      <Button
        variant="ghost"
        size="lg"
        className="mt-4"
        loading={skipping}
        onClick={async () => {
          setSkipping(true);
          try {
            await onSkip();
          } finally {
            setSkipping(false);
          }
        }}
      >
        Skip, I don't use either
      </Button>
    </Panel>
  );
}

function ServerOption({ name, onClick, children }: { name: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex flex-col items-start gap-1 rounded-2xl bg-ink/60 p-4 text-left ring-1 ring-line transition hover:bg-white/5 hover:ring-accent/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
    >
      <span className="text-lg font-semibold">{name}</span>
      <span className="text-sm text-muted">{children}</span>
    </button>
  );
}

export function Panel({
  title,
  back,
  children,
}: {
  title: string;
  /** A Back button beside the title, for a step that isn't in the URL. */
  back?: { onClick: () => void; label: string };
  children: ReactNode;
}) {
  return (
    <section>
      {back ? (
        <div className="mb-4 flex items-center gap-3">
          <BackButton {...back} />
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
      ) : (
        <h2 className="mb-4 text-xl font-semibold">{title}</h2>
      )}
      {children}
    </section>
  );
}

/** What differs between the services Curatorr connects to with an address and an API key. */
const SERVICES = {
  Radarr: {
    endpoint: '/api/setup/radarr',
    method: 'POST',
    urlPlaceholder: 'http://192.168.1.10:7878',
    keyHint: 'In Radarr: Settings, then General, then Security.',
    keyPlaceholder: '32 characters',
  },
  Seerr: {
    endpoint: '/api/settings/seerr',
    method: 'PUT',
    urlPlaceholder: 'http://192.168.1.10:5055',
    keyHint: 'In Seerr: Settings, then General, then API Key.',
    keyPlaceholder: 'Paste the key',
  },
};

export function ServiceForm({
  service,
  initialUrl,
  hasKey,
  intro,
  heading = true,
  actions,
  onSaved,
  onSkip,
}: {
  service: keyof typeof SERVICES;
  initialUrl: string;
  hasKey: boolean;
  intro?: ReactNode;
  /** Off where the service is already named above the form (Settings). */
  heading?: boolean;
  /** More buttons after Connect, like Cancel. */
  actions?: ReactNode;
  onSaved: () => void;
  /** Offers to go on without this service. */
  onSkip?: () => void;
}) {
  const config = SERVICES[service];
  const [url, setUrl] = useState(initialUrl);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The server only keeps a saved key for the address it was saved with.
  const keepsKey = hasKey && url.trim() === initialUrl;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api(config.endpoint, { method: config.method, json: { url, apiKey: apiKey || undefined } });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const form = (
    <>
      {intro && <p className="mb-4 text-muted">{intro}</p>}
      <form onSubmit={submit} className="space-y-4">
        <Field label={`${service} address`} hint="Include the port, and the URL base if you set one.">
          <input
            className={inputClass}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={config.urlPlaceholder}
            inputMode="url"
            autoComplete="off"
            required
          />
        </Field>
        <Field label="API key" hint={config.keyHint}>
          <input
            className={inputClass}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keepsKey ? 'Saved. Leave empty to keep it' : config.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            required={!keepsKey}
          />
        </Field>
        {error && <Notice>{error}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" type="submit" loading={saving}>
            Connect {service}
          </Button>
          {/* Not a submit button, or the empty required fields would stop it. */}
          {onSkip && (
            <Button variant="ghost" size="lg" type="button" onClick={onSkip} disabled={saving}>
              Skip, I don't use {service}
            </Button>
          )}
          {actions}
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-300">
              <Check className="size-4" /> Connected
            </span>
          )}
        </div>
      </form>
    </>
  );
  return heading ? <Panel title={`Connect ${service}`}>{form}</Panel> : form;
}

function Finish() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/setup/complete', { json: {} });
      await qc.invalidateQueries();
      navigate('/profiles', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Panel title="All set">
      <p className="text-muted">
        Curatorr will now read your Radarr library and keep it in sync every few hours. You can change any of this later
        in Settings.
      </p>
      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}
      <Button variant="primary" size="lg" className="mt-6" onClick={finish} loading={busy}>
        Finish setup
      </Button>
    </Panel>
  );
}
