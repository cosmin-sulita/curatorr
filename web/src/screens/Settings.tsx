import { SYNC_INTERVAL_HOURS, type AppStatus, type MediaServer, type SettingsProfile } from '@curatorr/shared';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, CircleFadingArrowUp, Copy, ExternalLink, LogOut, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FanCard } from '../components/FanCard';
import { PinPad } from '../components/PinPad';
import { BackButton, Shell } from '../components/Shell';
import { useToast } from '../components/Toast';
import { Avatar, Button, buttonClass, Notice, Spinner, Toggle } from '../components/ui';
import { WhatsNewDialog } from '../components/WhatsNew';
import {
  afterAccessChange,
  afterLibraryChange,
  errorMessage,
  keys,
  useHidden,
  useSettings,
  useStatus,
  type SettingsResponse,
} from '../lib/api';
import { useDeferUpdates } from '../lib/appUpdate';
import { plural, relativeTime, serverCopy, serverName } from '../lib/format';
import {
  importUsers,
  removeSeerr,
  renewWebhook,
  saveAppSettings,
  setProfilePin,
  showProfile,
  signOutEverywhere,
  signOutHere,
  syncNow,
} from '../lib/settings';
import { recentReleases } from '../lib/whatsNew';
import { ENTERED, ENTRANCE_SPRING, useEntrance } from '../lib/wizard';
import { JellyfinConnect, JellyfinSignIn } from './JellyfinConnect';
import { MARK_LISTS } from '../lib/marks';
import { OwnerSignIn, PlexConnect } from './PlexConnect';
import { RESTRICTION_LABEL } from './Profiles';
import { ServiceForm } from './Setup';

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-surface p-5 ring-1 ring-line sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsScreen() {
  const { data: status } = useStatus();
  const isAdmin = Boolean(status?.isAdmin);
  const settings = useSettings(isAdmin);
  const [showNews, setShowNews] = useState(false);
  // The profile whose PIN is being set, on a pad drawn outside Shell.
  const [pinFor, setPinFor] = useState<SettingsProfile | null>(null);
  // People leave to copy an API key or sign in to their media server; a reload on their return would lose that.
  useDeferUpdates();
  const entrance = useEntrance();

  return (
    <>
      <Shell>
        <div className="flex h-11 items-center">
          <BackButton />
        </div>

        {/* As on the other screens: the title in the same place, sliding in from the side it's reached from. */}
        <motion.section
          initial={entrance}
          animate={ENTERED}
          transition={ENTRANCE_SPRING}
          className="pt-6"
        >
          <h1 className="font-display text-[44px] sm:text-6xl">Settings</h1>

          <div className="mt-8 space-y-5">
            {status?.update && <UpdateAvailable release={status.update} running={status.version} />}
            {status?.profile && <ProfileLists server={status.server} />}
            {!isAdmin && <AdminSignIn server={status?.server ?? null} />}
            {isAdmin && settings.isLoading && <Spinner />}
            {isAdmin && settings.error && <Notice>{errorMessage(settings.error)}</Notice>}
            {isAdmin && settings.data && (
              <AdminSettings data={settings.data} demo={Boolean(status?.demo)} onPin={setPinFor} />
            )}
            <p className="pt-2 pb-6 text-center text-xs text-faint">
              Curatorr {status?.version}
              {status?.demo && ', demo mode'}
              {' · '}
              <button
                className="inline-flex h-11 items-center px-1 align-middle font-semibold text-muted underline-offset-2 transition hover:text-fg hover:underline press-dim"
                onClick={() => setShowNews(true)}
              >
                What's new
              </button>
            </p>
          </div>
        </motion.section>
      </Shell>
      {/* Outside Shell: its <main> is a stacking context below the header. */}
      <AnimatePresence>
        {showNews && <WhatsNewDialog releases={recentReleases} onClose={() => setShowNews(false)} />}
      </AnimatePresence>
      <AnimatePresence>{pinFor && <ProfilePin profile={pinFor} onClose={() => setPinFor(null)} />}</AnimatePresence>
    </>
  );
}

/**
 * Gives a Jellyfin profile a PIN Curatorr keeps, or a new one: four digits, then the same once more, so a slip of
 * the finger doesn't lock anyone out. A profile that has one can lose it here too.
 */
function ProfilePin({ profile, onClose }: { profile: SettingsProfile; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (pin: string | null) => {
    setBusy(true);
    try {
      await setProfilePin(profile.id, pin);
      await afterAccessChange(qc);
      toast({ message: pin ? `${profile.name}'s profile asks for this PIN now` : `${profile.name}'s profile has no PIN now` });
      onClose();
    } catch (err) {
      setFirst(null);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <PinPad
      profile={profile}
      title={first ? 'Enter it once more' : `${profile.pinProtected ? 'A new PIN' : 'A PIN'} for ${profile.name}`}
      subtitle={first ? 'To be sure of it.' : 'Asked on each device that picks this profile.'}
      error={error}
      busy={busy}
      footer={
        profile.pinProtected &&
        !first && (
          <Button variant="ghost" onClick={() => save(null)}>
            Remove the PIN
          </Button>
        )
      }
      onCancel={onClose}
      onSubmit={(pin) => {
        setError(null);
        if (!first) return setFirst(pin);
        if (pin !== first) {
          setFirst(null);
          return setError("The two didn't match. Choose it again.");
        }
        void save(pin);
      }}
    />
  );
}

/** A newer release is on GitHub (only admins are told): which one, and how to get it. */
function UpdateAvailable({ release, running }: { release: NonNullable<AppStatus['update']>; running: string }) {
  return (
    <section className="flex gap-3 rounded-3xl bg-accent/10 p-5 ring-1 ring-accent/25 sm:p-6">
      <CircleFadingArrowUp className="mt-0.5 size-6 shrink-0 text-indigo-300" aria-hidden />
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">Curatorr {release.version} is out</h2>
        <p className="mt-1 text-sm text-muted">
          You have {running}. Pull the new image and recreate the container, e.g. with{' '}
          <code className="font-mono text-[13px] text-fg">{'docker compose pull && docker compose up -d'}</code>.
        </p>
        <a href={release.url} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'md', 'mt-4')}>
          What's new in {release.version} <ExternalLink className="size-4" aria-hidden />
        </a>
      </div>
    </section>
  );
}

/**
 * The profile's own lists: movies on its watchlist (its media server's too), and movies it hid from picks. Each card
 * shows how many and the latest posters, and opens the whole list, where they can be restored.
 */
function ProfileLists({ server }: { server: MediaServer | null }) {
  const marked = useHidden();
  return (
    <section>
      <h2 className="text-lg font-semibold">Your lists</h2>
      <div className="mt-3 grid gap-3">
        {MARK_LISTS.map(({ id, kind, title, Icon, hint }) => {
          const movies = marked.data?.filter((m) => m.kind === kind) ?? [];
          const posters = movies.flatMap((m) => (m.movie.posterUrl ? [m.movie.posterUrl] : [])).slice(0, 3);
          return (
            <FanCard
              key={id}
              // An empty list has nothing to open: its card says how to add to it instead.
              to={movies.length ? `/settings/${id}` : undefined}
              // As tall as a card with posters, so the sections below stay put when the lists arrive.
              className="min-h-20 sm:min-h-22"
              icon={<Icon className="size-5" strokeWidth={1.75} aria-hidden />}
              title={title}
              subtitle={!marked.data ? ' ' : movies.length ? plural(movies.length, 'movie') : hint(server)}
              posters={posters}
            />
          );
        })}
      </div>
      {marked.error && (
        <div className="mt-3">
          <Notice>{errorMessage(marked.error)}</Notice>
        </div>
      )}
    </section>
  );
}

function AdminSignIn({ server }: { server: MediaServer | null }) {
  return (
    <Section title="Manage Curatorr" description={`Only ${serverCopy(server).admins} can change connections and profiles.`}>
      {server === 'jellyfin' ? <JellyfinSignIn /> : <OwnerSignIn />}
    </Section>
  );
}

/** The media server Curatorr is connected to, and as whom. */
function serverDescription({ server, plex, jellyfin }: SettingsResponse) {
  if (server === 'jellyfin' && jellyfin) {
    return `${jellyfin.serverName} (${jellyfin.url}), connected as ${jellyfin.ownerName}`;
  }
  if (plex.serverName) return `${plex.serverName} (${plex.serverUrl}), signed in as ${plex.ownerName}`;
  return server ? 'Not connected' : 'Not connected. Plex or Jellyfin brings profiles, watch history and parental limits.';
}

/** The intervals on offer, and the one saved when an older version allowed another, so the list shows it. */
const syncIntervals = (saved: number) =>
  [...new Set<number>([...SYNC_INTERVAL_HOURS, saved])].sort((a, b) => a - b);

/** What Radarr's last webhook call was about; null before the first one. */
function lastCall({ at, event, title }: SettingsResponse['webhook']) {
  if (!at) return null;
  const movie = title ?? 'a movie';
  // Radarr's other events reach Curatorr too when they're ticked; it only needs the first four.
  const events: Record<string, string> = {
    Test: 'a test',
    Download: `imported ${movie}`,
    MovieFileDelete: `deleted the file of ${movie}`,
    MovieDelete: `removed ${movie}`,
    Grab: `grabbed ${movie}`,
    Rename: `renamed ${movie}`,
    MovieAdded: `added ${movie}`,
    Health: 'a health warning',
    HealthRestored: 'a health warning cleared',
    ApplicationUpdate: 'an update of Radarr',
    ManualInteractionRequired: `${movie} needs a hand with its download`,
  };
  const what = (event && events[event]) ?? `a ${event} event`;
  return `Radarr last called ${relativeTime(at)}: ${what}.`;
}

/** What to do in Radarr with the address. */
const WEBHOOK_STEPS = [
  'In Radarr, open Settings → Connect and add a Webhook.',
  'Tick On File Import, On Movie Delete and On Movie File Delete.',
  'Paste the address below as its URL, press Test, then save.',
];

/** A URL with break points after its slashes, "?" and "=", so it wraps where it reads naturally. */
const breakable = (url: string) =>
  url.split(/(?<=[/?=])/).flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]));

/** The address Radarr calls when a movie is imported or deleted, so new downloads show up within minutes. */
function RadarrWebhook({ webhook }: { webhook: SettingsResponse['webhook'] }) {
  const { toast, refresh } = useSettingsChanges();
  const field = useRef<HTMLParagraphElement>(null);
  const [renewing, setRenewing] = useState<'ask' | 'busy' | null>(null);
  const address = `${window.location.origin}/api/radarr/webhook?token=${webhook.token}`;
  const called = lastCall(webhook);
  // Once Radarr has called, the steps are done with: they fold away until asked for. A new address, which has to be
  // pasted into Radarr again, brings them back, since Radarr hasn't called it yet.
  const [showSteps, setShowSteps] = useState(false);
  const folded = Boolean(called) && !showSteps;
  const stepsId = useId();

  const copy = async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(address);
      copied = true;
    } catch {
      // Plain-HTTP addresses have no clipboard API: select the address and copy that instead.
      const selection = window.getSelection();
      if (field.current && selection) {
        const range = document.createRange();
        range.selectNodeContents(field.current);
        selection.removeAllRanges();
        selection.addRange(range);
        copied = document.execCommand('copy');
      }
    }
    toast({ message: copied ? 'Copied the address' : 'Select the address and copy it' });
  };

  const renew = async () => {
    setRenewing('busy');
    try {
      await renewWebhook();
      toast({ message: 'Made a new address. Paste it into Radarr again.' });
    } catch (err) {
      toast({ message: errorMessage(err) });
    }
    setRenewing(null);
    refresh();
  };

  return (
    <Section
      title="New downloads within minutes"
      // Whether it works comes first: once it's set up, that's what someone comes here to check. The status dot
      // and the step numbers share one gutter, so their lines start together.
      description={
        <p className="flex gap-2" role="status">
          <span className="flex h-5 w-4 shrink-0 items-center" aria-hidden>
            <span className={clsx('size-2 rounded-full', called ? 'bg-emerald-400' : 'bg-faint')} />
          </span>
          <span>{called ?? "Radarr hasn't called yet."}</span>
        </p>
      }
    >
      {called && (
        <Button
          variant="ghost"
          className="-mt-2 -ml-4"
          aria-expanded={!folded}
          aria-controls={stepsId}
          onClick={() => setShowSteps(!showSteps)}
        >
          How to set it up
          <ChevronDown className={clsx('size-4 transition-transform', !folded && 'rotate-180')} aria-hidden />
        </Button>
      )}
      {!folded && (
        <ol id={stepsId} className={clsx('space-y-1 text-sm text-muted', called && 'mt-1')}>
          {WEBHOOK_STEPS.map((step, i) => (
            <li key={step} className="flex gap-2">
              <span className="w-4 shrink-0 text-faint tabular-nums">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {/* The whole address, wrapped: a phone would only show its start in a field. A tap selects it all. */}
      <p
        ref={field}
        className="mt-4 rounded-xl bg-ink px-3.5 py-3 font-mono text-sm wrap-anywhere select-all ring-1 ring-line"
      >
        {breakable(address)}
      </p>
      {!folded && (
        <p className="mt-1.5 text-xs text-faint">
          If Radarr reaches Curatorr at another address, keep the part from /api/radarr/webhook on.
        </p>
      )}
      {/* Keyed, so each row gets buttons of its own instead of the others fading into them. */}
      {renewing === 'ask' ? (
        <div key="ask" className="mt-4 flex flex-wrap items-center gap-3">
          <p className="w-full text-sm">The current address will stop working.</p>
          <Button variant="danger" onClick={renew}>
            Make a new address
          </Button>
          <Button variant="ghost" onClick={() => setRenewing(null)} autoFocus>
            Cancel
          </Button>
        </div>
      ) : (
        <div key="actions" className="mt-4 flex flex-wrap gap-3">
          <Button onClick={copy}>
            <Copy className="size-4" /> Copy address
          </Button>
          <Button variant="ghost" loading={renewing === 'busy'} onClick={() => setRenewing('ask')}>
            New address
          </Button>
        </div>
      )}
    </Section>
  );
}

/**
 * A service Curatorr connects to: its name, where it is, and a quiet button to change it (these change rarely).
 * `children` go under it: the form while it's being changed (`editing`), or a notice. `row` names it for focus.
 */
function Connection({
  row,
  name,
  detail,
  action,
  editing = false,
  children,
}: {
  row: string;
  name: string;
  detail: ReactNode;
  action?: ReactNode;
  editing?: boolean;
  children?: ReactNode;
}) {
  return (
    <li data-row={row} className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-medium">{name}</h3>
          <div className="mt-0.5 text-sm text-muted wrap-anywhere">{detail}</div>
        </div>
        {/* Centred on the name, with the ghost button's padding hanging out, so its label ends where switches do. */}
        {action && <div className="-mt-2.5 -mr-4 shrink-0">{action}</div>}
      </div>
      {children && (
        <div
          className="mt-4 focus:outline-none"
          // An open form takes focus (see AdminSettings), so that Tab leads into it.
          {...(editing ? { 'data-form': '', tabIndex: -1, role: 'group', 'aria-label': `Change ${name}` } : {})}
        >
          {children}
        </div>
      )}
    </li>
  );
}

/** The Connections row a form opens in: Plex and Jellyfin share the media server's. */
const rowOf = (e: Editing) => (e === 'radarr' || e === 'seerr' ? e : 'server');

/**
 * Disconnecting Seerr forgets its API key and the requests read from it, with nothing to undo, so it asks first,
 * away from the form's own buttons.
 */
function DisconnectSeerr({ onConfirm }: { onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  // Keyed, so each row gets buttons of its own instead of the others fading into them.
  return asking ? (
    <div key="ask" className="mt-5 flex flex-wrap items-center gap-3">
      <p className="w-full text-sm">Picks stop favouring requested movies, and Curatorr forgets the API key.</p>
      <Button variant="danger" onClick={onConfirm}>
        Disconnect Seerr
      </Button>
      <Button variant="ghost" onClick={() => setAsking(false)} autoFocus>
        Keep Seerr
      </Button>
    </div>
  ) : (
    <div key="start" className="mt-5">
      <Button variant="ghost" className="-ml-4" onClick={() => setAsking(true)}>
        Disconnect Seerr
      </Button>
    </div>
  );
}

/**
 * Signing out every other device can't be undone (each one signs in, and enters its PINs, again), so it asks first,
 * like disconnecting Seerr.
 */
function SignOutEverywhere({ onConfirm }: { onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <div key="ask" className="flex flex-wrap items-center justify-center gap-3 px-4 pb-2 text-center">
      <p className="w-full text-sm">
        Every other phone and browser has to sign in to settings again, and enter the PINs it had. This one stays as it
        is.
      </p>
      <Button
        variant="danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Sign out other devices
      </Button>
      <Button variant="ghost" onClick={() => setAsking(false)} autoFocus>
        Cancel
      </Button>
    </div>
  ) : (
    <Button key="start" variant="ghost" className="w-full" onClick={() => setAsking(true)}>
      <MonitorSmartphone className="size-4" /> Sign out all other devices
    </Button>
  );
}

/** Which connection is being changed. One at a time. */
type Editing = 'radarr' | 'seerr' | MediaServer;

/**
 * What the admin sections share: refreshing Settings and the status after a change, running one with a toast for how
 * it went, and switches that move as soon as they're tapped (the refresh after saving settles the real state).
 */
function useSettingsChanges() {
  const qc = useQueryClient();
  const toast = useToast();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.settings });
    qc.invalidateQueries({ queryKey: keys.status });
  };

  const run = async (change: () => Promise<unknown>, success?: string) => {
    try {
      await change();
      if (success) toast({ message: success });
    } catch (err) {
      toast({ message: errorMessage(err) });
    } finally {
      refresh();
    }
  };

  const optimistic = async (change: (d: SettingsResponse) => SettingsResponse) => {
    await qc.cancelQueries({ queryKey: keys.settings });
    qc.setQueryData<SettingsResponse>(keys.settings, (d) => d && change(d));
  };

  const updateApp = (patch: Partial<SettingsResponse['app']>) =>
    run(async () => {
      await optimistic((d) => ({ ...d, app: { ...d.app, ...patch } }));
      await saveAppSettings(patch);
      afterLibraryChange(qc);
    });

  return { qc, toast, refresh, run, optimistic, updateApp };
}

/** How Settings names the media server, and whether it's connected far enough to have read movies and users from it. */
function serverState(data: SettingsResponse) {
  const copy = serverCopy(data.server);
  return { name: copy.name, copy, connected: data.server === 'jellyfin' || Boolean(data.plex.machineId) };
}

function AdminSettings({
  data,
  demo,
  onPin,
}: {
  data: SettingsResponse;
  demo: boolean;
  /** Sets, changes or removes a Jellyfin profile's PIN. */
  onPin: (profile: SettingsProfile) => void;
}) {
  return (
    <>
      <LibrarySection data={data} demo={demo} />
      {!demo && data.radarr && <RadarrWebhook webhook={data.webhook} />}
      <PicksSection data={data} demo={demo} />
      {!demo && <ConnectionsSection data={data} />}
      <ProfilesSection data={data} onPin={onPin} />
      {!demo && (data.plex.ownerName || data.jellyfin) && <SignOutSection />}
    </>
  );
}

function LibrarySection({ data, demo }: { data: SettingsResponse; demo: boolean }) {
  const { run, updateApp } = useSettingsChanges();
  const { sync } = data;
  const { name, connected } = serverState(data);
  return (
    <Section title="Library">
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-muted">Movies</dt>
          <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{sync.movies}</dd>
        </div>
        {connected && (
          <div>
            <dt className="text-muted">Found in {name}</dt>
            <dd className="mt-0.5 text-2xl font-semibold tabular-nums">{sync.matched}</dd>
          </div>
        )}
      </dl>
      {sync.error && (
        <div className="mt-4">
          <Notice>Last sync failed: {sync.error}</Notice>
        </div>
      )}
      <div className="mt-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Last sync</span>
            <span className="block text-sm text-muted">{sync.syncing ? 'Syncing now…' : relativeTime(sync.at)}</span>
          </span>
          {!demo && (
            <Button onClick={() => run(syncNow)} loading={sync.syncing}>
              {!sync.syncing && <RefreshCw className="size-4" />} Sync now
            </Button>
          )}
        </div>
        {!demo && (
          <label className="flex items-center justify-between gap-4">
            <span className="font-medium">Sync with Radarr every</span>
            <select
              className="h-11 rounded-xl bg-ink px-3 ring-1 ring-line"
              value={data.app.syncIntervalHours}
              onChange={(e) => updateApp({ syncIntervalHours: Number(e.target.value) })}
            >
              {syncIntervals(data.app.syncIntervalHours).map((h) => (
                <option key={h} value={h}>
                  {plural(h, 'hour')}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </Section>
  );
}

function PicksSection({ data, demo }: { data: SettingsResponse; demo: boolean }) {
  const { updateApp } = useSettingsChanges();
  const { name, copy, connected } = serverState(data);
  return (
    <Section title="Picks">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Include movies already watched</span>
            <span className="block text-sm text-muted">Off: anything a profile watched in {name} is skipped.</span>
          </span>
          <Toggle
            label="Include movies already watched"
            checked={data.app.includeWatched}
            onChange={(v) => updateApp({ includeWatched: v })}
          />
        </div>
        {!demo && connected && (
          <div className="flex items-center justify-between gap-4">
            <span>
              <span className="block font-medium">Update {name} when you mark movies</span>
              <span className="block text-sm text-muted">
                Seen it marks the movie {copy.watched} in {name}. Watchlist adds it to your {copy.watchlist}, and a movie
                taken off there leaves Curatorr's watchlist too.
              </span>
            </span>
            <Toggle
              label={`Update ${name} when you mark movies`}
              checked={data.app.syncToServer}
              onChange={(v) => updateApp({ syncToServer: v })}
            />
          </div>
        )}
        {/* The demo has requests built in. */}
        {(demo || data.seerr) && (
          <div className="flex items-center justify-between gap-4">
            <span>
              <span className="block font-medium">Favour movies people requested</span>
              <span className="block text-sm text-muted">
                Unwatched Seerr requests rank higher for whoever asked, and say so.
              </span>
            </span>
            <Toggle
              label="Favour movies people requested"
              checked={data.app.boostRequests}
              onChange={(v) => updateApp({ boostRequests: v })}
            />
          </div>
        )}
      </div>
    </Section>
  );
}

function ConnectionsSection({ data }: { data: SettingsResponse }) {
  const { qc, toast, refresh, run } = useSettingsChanges();
  const [editing, setEditing] = useState<Editing | null>(null);
  const { seerr } = data;
  const { name } = serverState(data);

  // Opening or closing a form takes away the button that was pressed, and focus with it. Keyboard and screen reader
  // users then carry on in the form, and on its row's button once it closes, rather than at the top of the page.
  const wasEditing = useRef<Editing | null>(null);
  useEffect(() => {
    const closed = wasEditing.current;
    wasEditing.current = editing;
    if (document.activeElement && document.activeElement !== document.body) return;
    const which = editing ?? closed;
    const row = which && document.querySelector(`[data-row="${rowOf(which)}"]`);
    if (!row) return;
    // The row's own button comes first in it: Change, or Connect.
    const target = row.querySelector<HTMLElement>(editing ? '[data-form]' : 'button');
    target?.focus({ preventScroll: true });
  }, [editing]);

  const change = (what: Editing, service: string, label = 'Change') => (
    <Button variant="ghost" onClick={() => setEditing(what)} aria-label={`${label} ${service}`}>
      {label}
    </Button>
  );
  // Closes the form. Whatever a Plex or Jellyfin change already saved stays saved, as when leaving the page.
  const cancel = (
    <Button
      variant="ghost"
      size="lg"
      type="button"
      onClick={() => {
        setEditing(null);
        refresh();
      }}
    >
      Cancel
    </Button>
  );
  const syncAfter = (message: string) => {
    setEditing(null);
    run(syncNow, message);
  };

  return (
    <Section title="Connections">
      <ul className="divide-y divide-line">
        <Connection
          row="radarr"
          name="Radarr"
          detail={data.radarr?.url ?? 'Not connected'}
          editing={editing === 'radarr'}
          action={editing !== 'radarr' && change('radarr', 'Radarr', data.radarr ? 'Change' : 'Connect')}
        >
          {editing === 'radarr' && (
            <ServiceForm
              service="Radarr"
              heading={false}
              initialUrl={data.radarr?.url ?? ''}
              hasKey={Boolean(data.radarr?.hasApiKey)}
              actions={cancel}
              onSaved={() => {
                setEditing(null);
                refresh();
                toast({ message: 'Radarr connected. Syncing your library.' });
              }}
            />
          )}
        </Connection>

        <Connection
          row="server"
          name={data.server ? name : 'Media server'}
          detail={serverDescription(data)}
          editing={editing === 'plex' || editing === 'jellyfin'}
          action={
            // Plex or Jellyfin is chosen once, in setup; one set up without either can connect one here.
            editing !== data.server &&
            (data.server === 'jellyfin'
              ? change('jellyfin', 'Jellyfin')
              : data.server === 'plex' && change('plex', 'Plex', data.plex.machineId ? 'Change' : 'Connect'))
          }
        >
          {editing === 'plex' ? (
            <>
              <PlexConnect signedIn={data.plex.signedIn} saved={data.plex} onDone={() => syncAfter('Plex connected')} />
              <div className="mt-3">{cancel}</div>
            </>
          ) : editing === 'jellyfin' ? (
            <>
              <JellyfinConnect saved={data.jellyfin} onDone={() => syncAfter('Jellyfin connected')} />
              <div className="mt-3">{cancel}</div>
            </>
          ) : (
            !data.server && (
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => setEditing('plex')}>Connect Plex</Button>
                <Button onClick={() => setEditing('jellyfin')}>Connect Jellyfin</Button>
              </div>
            )
          )}
        </Connection>

        <Connection
          row="seerr"
          name="Seerr"
          editing={editing === 'seerr'}
          detail={
            seerr ? (
              <>
                <span className="block">{seerr.url}</span>
                <span className="block">
                  {plural(seerr.requests, 'requested movie')} in your library, for {plural(seerr.profiles, 'profile')}
                  {seerr.at && `, read ${relativeTime(seerr.at)}`}
                </span>
              </>
            ) : (
              'Optional. Picks favour movies each person requested in Seerr.'
            )
          }
          action={editing !== 'seerr' && change('seerr', 'Seerr', seerr ? 'Change' : 'Connect')}
        >
          {editing === 'seerr' ? (
            <>
              <ServiceForm
                service="Seerr"
                heading={false}
                initialUrl={seerr?.url ?? ''}
                hasKey={Boolean(seerr?.hasApiKey)}
                actions={cancel}
                onSaved={() => {
                  setEditing(null);
                  afterLibraryChange(qc);
                  refresh();
                  toast({ message: 'Seerr connected' });
                }}
              />
              {seerr && (
                <DisconnectSeerr
                  onConfirm={() => {
                    setEditing(null);
                    run(async () => {
                      await removeSeerr();
                      afterLibraryChange(qc);
                    }, 'Seerr disconnected');
                  }}
                />
              )}
            </>
          ) : (
            seerr?.error && <Notice>Last read failed: {seerr.error}</Notice>
          )}
        </Connection>
      </ul>
    </Section>
  );
}

function ProfilesSection({ data, onPin }: { data: SettingsResponse; onPin: (profile: SettingsProfile) => void }) {
  const { qc, run, optimistic } = useSettingsChanges();
  const [refreshing, setRefreshing] = useState(false);
  const { name, copy, connected } = serverState(data);

  const refreshProfiles = async () => {
    setRefreshing(true);
    await run(() => importUsers(data.server ?? 'plex'), `Profiles updated from ${copy.home}`);
    qc.invalidateQueries({ queryKey: keys.profiles });
    setRefreshing(false);
  };

  return (
    <Section title="Profiles" description="Hidden profiles don't appear on the Who's watching screen.">
      <ul className="divide-y divide-line">
        {data.profiles.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-3">
            <Avatar name={p.name} src={p.avatarUrl} className="size-10" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{p.name}</span>
              <span className="block text-xs text-muted">
                {p.isAdmin
                  ? copy.adminTitle
                  : p.restrictionProfile
                    ? `Restricted to ${RESTRICTION_LABEL[p.restrictionProfile]} by ${name}`
                    : 'Member'}
                {p.serverUser && !p.linked && ', waiting for PIN'}
              </span>
            </span>
            {/* Jellyfin has no PINs, so Curatorr keeps one for whoever needs it. */}
            {data.server === 'jellyfin' && p.serverUser && (
              <Button variant="ghost" className="shrink-0 px-3" onClick={() => onPin(p)}>
                {p.pinProtected ? 'Change PIN' : 'Set PIN'}
              </Button>
            )}
            {/* The Plex owner always shows. A Jellyfin administrator may be an account nobody watches with. */}
            {(!p.isAdmin || data.server === 'jellyfin') && (
              <Toggle
                label={`Show ${p.name}`}
                checked={!p.hidden}
                onChange={(show) =>
                  run(async () => {
                    await optimistic((d) => ({
                      ...d,
                      profiles: d.profiles.map((x) => (x.id === p.id ? { ...x, hidden: !show } : x)),
                    }));
                    await showProfile(p.id, show);
                    qc.invalidateQueries({ queryKey: keys.profiles });
                  })
                }
              />
            )}
          </li>
        ))}
      </ul>
      {connected && (
        <Button variant="ghost" className="mt-2 -ml-4" loading={refreshing} onClick={refreshProfiles}>
          {!refreshing && <RefreshCw className="size-4" />} Refresh profiles from {copy.home}
        </Button>
      )}
    </Section>
  );
}

function SignOutSection() {
  const { qc, run } = useSettingsChanges();
  return (
    <>
      <Button variant="ghost" className="w-full" onClick={() => run(() => signOutHere().then(() => afterAccessChange(qc)))}>
        <LogOut className="size-4" /> Sign out of settings on this device
      </Button>
      <SignOutEverywhere onConfirm={() => run(signOutEverywhere, 'Signed out all other devices')} />
    </>
  );
}
