import { useQueryClient } from '@tanstack/react-query';
import { LogOut, RefreshCw } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { BackButton, Shell } from '../components/Shell';
import { useToast } from '../components/Toast';
import { Avatar, Button, Img, Notice, Spinner, Toggle } from '../components/ui';
import { WhatsNewDialog } from '../components/WhatsNew';
import {
  api,
  errorMessage,
  undoFeedback,
  useHidden,
  useSettings,
  useStatus,
  type HiddenMovie,
  type SettingsResponse,
} from '../lib/api';
import { plural, relativeTime } from '../lib/format';
import { usePlexSignIn } from '../lib/plexAuth';
import { recentReleases } from '../lib/whatsNew';
import { PlexConnect } from './PlexConnect';
import { RadarrForm } from './Setup';

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-surface p-5 ring-1 ring-line sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsScreen() {
  const { data: status } = useStatus();
  const isAdmin = Boolean(status?.isAdmin);
  const settings = useSettings(isAdmin);
  const [showNews, setShowNews] = useState(false);

  return (
    <>
      <Shell>
        <BackButton />
        <h1 className="mt-3 font-display text-5xl">Settings</h1>

        <div className="mt-8 space-y-5">
          {status?.profile && <ProfileLists name={status.profile.name} />}
          {!isAdmin && <AdminSignIn />}
          {isAdmin && settings.isLoading && <Spinner />}
          {isAdmin && settings.error && <Notice>{errorMessage(settings.error)}</Notice>}
          {isAdmin && settings.data && <AdminSettings data={settings.data} demo={Boolean(status?.demo)} />}
          <p className="pt-2 pb-6 text-center text-xs text-faint">
            Curatorr {status?.version}
            {status?.demo && ', demo mode'}
            {' · '}
            <button
              className="inline-flex h-11 items-center px-1 align-middle font-semibold text-muted underline-offset-2 hover:text-fg hover:underline"
              onClick={() => setShowNews(true)}
            >
              What's new
            </button>
          </p>
        </div>
      </Shell>
      {/* Outside Shell: its <main> is a stacking context below the header. */}
      <AnimatePresence>
        {showNews && <WhatsNewDialog releases={recentReleases} onClose={() => setShowNews(false)} />}
      </AnimatePresence>
    </>
  );
}

/** The profile's own marks: movies added to the watchlist, and movies hidden from picks. */
function ProfileLists({ name }: { name: string }) {
  const marked = useHidden();
  const qc = useQueryClient();
  const toast = useToast();
  const unmark = async (id: number) => {
    try {
      const res = await undoFeedback(id);
      if (res.plex === 'failed') toast({ message: "Removed here, but Plex couldn't be updated" });
    } catch (err) {
      toast({ message: errorMessage(err) });
    }
    qc.invalidateQueries({ queryKey: ['hidden'] });
    qc.invalidateQueries({ queryKey: ['wizard'] });
    qc.removeQueries({ queryKey: ['recommendations'] });
  };

  const later = marked.data?.filter((m) => m.kind === 'later') ?? [];
  const hidden = marked.data?.filter((m) => m.kind !== 'later') ?? [];

  const list = (items: HiddenMovie[], action: string) => (
    <ul className="divide-y divide-line">
      {items.map((h) => (
        <li key={h.id} className="flex items-center gap-3 py-2.5">
          <Img src={h.movie.posterUrl} className="h-14 w-10 shrink-0 rounded-md object-cover" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{h.movie.title}</span>
            <span className="text-xs text-muted">
              {h.kind === 'later' ? 'On your watchlist' : h.kind === 'seen' ? 'Seen' : 'Never suggest'}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => unmark(h.id)}>
            {action}
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {later.length > 0 && (
        <Section title="Your watchlist" description={`Movies ${name} added from a pick. Picks favour them.`}>
          {list(later, 'Remove')}
        </Section>
      )}
      <Section title={`Hidden for ${name}`} description="Movies marked as seen or never. Restore one to see it in picks again.">
        {marked.isLoading && <Spinner className="size-5" />}
        {marked.data && hidden.length === 0 && <p className="text-sm text-faint">Nothing hidden yet.</p>}
        {list(hidden, 'Restore')}
      </Section>
    </>
  );
}

function AdminSignIn() {
  const qc = useQueryClient();
  const signIn = usePlexSignIn('login', () => qc.invalidateQueries());
  return (
    <Section title="Manage Curatorr" description="Only the Plex server owner can change connections and profiles.">
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
    </Section>
  );
}

const SYNC_INTERVALS = [1, 3, 6, 12, 24];

function AdminSettings({ data, demo }: { data: SettingsResponse; demo: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editRadarr, setEditRadarr] = useState(false);
  const [editPlex, setEditPlex] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['settings'] });
    qc.invalidateQueries({ queryKey: ['status'] });
  };

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast({ message: success });
    } catch (err) {
      toast({ message: errorMessage(err) });
    } finally {
      refresh();
    }
  };

  const updateApp = (patch: Partial<SettingsResponse['app']>) =>
    run(async () => {
      await api('/api/settings/app', { method: 'PUT', json: patch });
      qc.removeQueries({ queryKey: ['wizard'] });
      qc.removeQueries({ queryKey: ['recommendations'] });
    });

  const { sync } = data;

  return (
    <>
      <Section title="Library">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Movies</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{sync.movies}</dd>
          </div>
          {data.plex.machineId && (
            <div>
              <dt className="text-muted">Found in Plex</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{sync.matchedInPlex}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted">Last sync</dt>
            <dd className="mt-0.5 text-base font-medium">{sync.syncing ? 'Syncing now…' : relativeTime(sync.at)}</dd>
          </div>
        </dl>
        {sync.error && (
          <div className="mt-4">
            <Notice>Last sync failed: {sync.error}</Notice>
          </div>
        )}
        {!demo && (
          <Button className="mt-5" onClick={() => run(() => api('/api/sync', { json: {} }))} loading={sync.syncing}>
            <RefreshCw className="size-4" /> Sync now
          </Button>
        )}
      </Section>

      <Section title="Picks">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span>
              <span className="block font-medium">Include movies already watched</span>
              <span className="block text-sm text-muted">Off: anything a profile watched in Plex is skipped.</span>
            </span>
            <Toggle
              label="Include movies already watched"
              checked={data.app.includeWatched}
              onChange={(v) => updateApp({ includeWatched: v })}
            />
          </div>
          {!demo && data.plex.machineId && (
            <div className="flex items-center justify-between gap-4">
              <span>
                <span className="block font-medium">Update Plex when you mark movies</span>
                <span className="block text-sm text-muted">
                  Seen it marks the movie watched in Plex. Watchlist adds it to your Plex Watchlist.
                </span>
              </span>
              <Toggle
                label="Update Plex when you mark movies"
                checked={data.app.syncToPlex}
                onChange={(v) => updateApp({ syncToPlex: v })}
              />
            </div>
          )}
          {!demo && (
            <label className="flex items-center justify-between gap-4">
              <span className="font-medium">Sync with Radarr every</span>
              <select
                className="h-10 rounded-xl bg-ink px-3 ring-1 ring-line"
                value={data.app.syncIntervalHours}
                onChange={(e) => updateApp({ syncIntervalHours: Number(e.target.value) })}
              >
                {SYNC_INTERVALS.map((h) => (
                  <option key={h} value={h}>
                    {plural(h, 'hour')}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Section>

      {!demo && (
        <Section title="Radarr" description={data.radarr?.url ?? 'Not connected'}>
          {editRadarr ? (
            <RadarrForm
              initialUrl={data.radarr?.url ?? ''}
              hasKey={Boolean(data.radarr?.hasApiKey)}
              onSaved={() => {
                setEditRadarr(false);
                refresh();
                toast({ message: 'Radarr connected. Syncing your library.' });
              }}
            />
          ) : (
            <Button onClick={() => setEditRadarr(true)}>Change connection</Button>
          )}
        </Section>
      )}

      {!demo && (
        <Section
          title="Plex"
          description={
            data.plex.serverName
              ? `${data.plex.serverName} (${data.plex.serverUrl}), signed in as ${data.plex.ownerName}`
              : 'Not connected'
          }
        >
          {editPlex ? (
            <PlexConnect
              signedIn={data.plex.signedIn}
              onDone={() => {
                setEditPlex(false);
                run(() => api('/api/sync', { json: {} }), 'Plex connected');
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setEditPlex(true)}>{data.plex.machineId ? 'Change server or libraries' : 'Connect Plex'}</Button>
              {data.plex.machineId && (
                <Button
                  variant="ghost"
                  loading={refreshing}
                  onClick={async () => {
                    setRefreshing(true);
                    await run(() => api('/api/setup/plex/users', { json: {} }), 'Profiles updated from Plex Home');
                    qc.invalidateQueries({ queryKey: ['profiles'] });
                    setRefreshing(false);
                  }}
                >
                  Refresh profiles from Plex Home
                </Button>
              )}
            </div>
          )}
        </Section>
      )}

      <Section title="Profiles" description="Hidden profiles don't appear on the Who's watching screen.">
        <ul className="divide-y divide-line">
          {data.profiles.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <Avatar name={p.name} src={p.avatarUrl} className="size-10" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block text-xs text-muted">
                  {p.isAdmin ? 'Owner' : p.restrictionProfile ? 'Restricted by Plex' : 'Member'}
                  {p.plexUser && !p.linked && ', waiting for PIN'}
                </span>
              </span>
              <Toggle
                label={`Show ${p.name}`}
                checked={!p.hidden}
                onChange={(show) =>
                  run(async () => {
                    if (p.isAdmin && !show) throw new Error("The owner's profile can't be hidden");
                    await api(`/api/profiles/${p.id}`, { method: 'PATCH', json: { hidden: !show } });
                    qc.invalidateQueries({ queryKey: ['profiles'] });
                  })
                }
              />
            </li>
          ))}
        </ul>
      </Section>

      {!demo && data.plex.ownerName && (
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => run(() => api('/api/admin/logout', { json: {} }).then(() => qc.invalidateQueries()))}
        >
          <LogOut className="size-4" /> Sign out of settings on this device
        </Button>
      )}
    </>
  );
}
