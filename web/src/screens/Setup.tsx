import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Shell } from '../components/Shell';
import { Button, Field, inputClass, Notice, Spinner } from '../components/ui';
import { api, errorMessage, useSettings } from '../lib/api';
import { useDeferUpdates } from '../lib/appUpdate';
import { navigate } from '../lib/router';
import { PlexConnect } from './PlexConnect';

type Step = 'radarr' | 'plex' | 'finish';
const STEPS: { id: Step; label: string }[] = [
  { id: 'radarr', label: 'Radarr' },
  { id: 'plex', label: 'Plex' },
  { id: 'finish', label: 'Finish' },
];

export function SetupScreen() {
  const settings = useSettings(true);
  const [step, setStep] = useState<Step | null>(null);
  const current: Step = step ?? (settings.data?.radarr ? 'plex' : 'radarr');
  // People leave to copy an API key or sign in to Plex; a reload on their return would lose that.
  useDeferUpdates();

  return (
    <Shell bare>
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
          ) : current === 'radarr' ? (
            <ServiceForm
              service="Radarr"
              initialUrl={settings.data?.radarr?.url ?? ''}
              hasKey={false}
              onSaved={() => setStep('plex')}
            />
          ) : current === 'plex' ? (
            <Panel title="Connect Plex">
              <PlexConnect
                signedIn={Boolean(settings.data?.plex.signedIn)}
                onDone={() => setStep('finish')}
                onSkip={async () => {
                  await api('/api/setup/plex/skip', { json: {} });
                  setStep('finish');
                }}
              />
            </Panel>
          ) : (
            <Finish />
          )}
        </div>
      </div>
    </Shell>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold">{title}</h2>
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
  onSaved,
}: {
  service: keyof typeof SERVICES;
  initialUrl: string;
  hasKey: boolean;
  onSaved: () => void;
}) {
  const config = SERVICES[service];
  const [url, setUrl] = useState(initialUrl);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  return (
    <Panel title={`Connect ${service}`}>
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
            placeholder={hasKey ? 'Saved. Leave empty to keep it' : config.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            required={!hasKey}
          />
        </Field>
        {error && <Notice>{error}</Notice>}
        <div className="flex items-center gap-3">
          <Button variant="primary" size="lg" type="submit" loading={saving}>
            Connect {service}
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-300">
              <Check className="size-4" /> Connected
            </span>
          )}
        </div>
      </form>
    </Panel>
  );
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
