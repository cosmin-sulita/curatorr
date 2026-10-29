import { randomUUID } from 'node:crypto';
import type { ImportedProfile, ServerLibraries } from '@curatorr/shared';
import { z } from 'zod';
import { parse, serviceUrl, type RouteModule } from '../context.js';
import { Guesses } from '../guesses.js';
import { HttpError, normalizeBaseUrl, UpstreamError } from '../http.js';
import { JellyfinClient, jellyfinIdKey, supportedJellyfin, type JellyfinUser } from '../integrations/jellyfin.js';
import { importJellyfinUsers, saveJellyfinProfile } from '../services/jellyfin.js';
import { profileFor, requireAdmin, setAdminCookie } from '../session.js';

const username = z.string().trim().max(256);
const password = z.string().max(256);

/** Wrong passwords Settings sign-in passes on to Jellyfin before the person has signed in to Jellyfin itself. */
const SIGN_IN_TRIES = 2;

/**
 * How many wrong passwords in a row Settings sign-in may pass on for an account: two, but never so many that
 * Jellyfin would disable it, with room left for wrong ones typed in Jellyfin's own apps meanwhile.
 */
function passwordTries(lockoutAfter: number | null | undefined): number {
  return lockoutAfter == null ? SIGN_IN_TRIES : Math.min(Math.max(lockoutAfter - 2, 0), SIGN_IN_TRIES);
}

export const jellyfinRoutes: RouteModule = (app, { store, library }) => {
  // Open until someone connects Plex or Jellyfin, then admin-only (see isAdmin).
  const guard = (req: Parameters<typeof requireAdmin>[0]) => requireAdmin(req, store);
  // Jellyfin can lock an account after a few wrong passwords: Curatorr mustn't be a way to guess them.
  const wrongPasswords = new Guesses();

  async function signIn(client: JellyfinClient, name: string, secret: string) {
    const key = name.toLowerCase();
    // Counted as wrong before Jellyfin checks it, so passwords sent all at once can't all get through.
    const wait = wrongPasswords.take(key);
    if (wait) throw new HttpError(429, `Too many wrong passwords. Try again in ${wait}`);
    try {
      const account = await client.authenticate(name, secret);
      wrongPasswords.hit(key);
      return account;
    } catch (err) {
      if (!(err instanceof UpstreamError && err.status === 401)) {
        // No answer about the password (Jellyfin couldn't be reached, say), so it doesn't count.
        wrongPasswords.refund(key);
        throw err;
      }
      throw new HttpError(400, "Jellyfin didn't accept that username and password");
    }
  }

  /**
   * Connects Jellyfin as one of its administrators, or changes the connection. Curatorr keeps that
   * token to read and mark every user's movies, and lets Plex go: it uses one media server.
   */
  app.post('/api/setup/jellyfin', async (req, reply): Promise<ServerLibraries> => {
    guard(req);
    const body = parse(
      z.object({
        url: serviceUrl,
        publicUrl: z.union([serviceUrl, z.literal('')]).optional(),
        username: username.optional(),
        password: password.optional(),
      }),
      req.body,
    );
    if (store.plexConfigured() && store.get('setupComplete')) throw new HttpError(409, 'Curatorr is set up with Plex');

    const url = normalizeBaseUrl(body.url);
    const saved = store.get('jellyfin');
    // An empty password keeps the current sign-in, for the same address only. (An administrator
    // always has a password in Jellyfin.)
    const keep = !body.password && saved?.url === url ? saved : null;
    const { username: name = '', password: secret = '' } = body;
    if (!keep && !(name && secret)) throw new HttpError(400, "Enter an administrator's username and password");

    const deviceId = saved?.deviceId ?? randomUUID();
    const info = await new JellyfinClient(url, deviceId).publicInfo();
    if (!supportedJellyfin(info.version)) {
      const runs = info.version || 'an older one';
      throw new HttpError(400, `Curatorr needs Jellyfin 10.9 or later, and this server runs ${runs}`);
    }

    let account = keep && { token: keep.token, user: { id: keep.ownerId, name: keep.ownerName } };
    if (!account) {
      const { token, user } = await signIn(new JellyfinClient(url, deviceId), name, secret);
      if (!user.admin) {
        // Only an administrator's token may read and mark everyone's movies.
        await new JellyfinClient(url, deviceId, token).logout().catch(() => {});
        throw new HttpError(403, `${user.name} isn't a Jellyfin administrator`);
      }
      account = { token, user };
    }

    const libraries = await new JellyfinClient(url, deviceId, account.token).movieLibraries().catch((err) => {
      if (keep && err instanceof UpstreamError && err.status === 401) {
        throw new HttpError(400, "Jellyfin no longer accepts Curatorr's sign-in. Enter the password to sign in again");
      }
      throw err;
    });
    store.resetPlex();
    store.set('jellyfin', {
      url,
      publicUrl: body.publicUrl ? normalizeBaseUrl(body.publicUrl) : null,
      serverId: info.id,
      serverName: info.name,
      deviceId,
      token: account.token,
      ownerId: account.user.id,
      ownerName: account.user.name,
      // Another server's libraries mean nothing here.
      libraryIds: saved?.serverId === info.id ? saved.libraryIds : [],
    });
    setAdminCookie(reply, store, account.user.id);
    return { ok: true, libraries };
  });

  app.post('/api/setup/jellyfin/libraries', async (req) => {
    guard(req);
    const { libraryIds } = parse(z.object({ libraryIds: z.array(z.string()).min(1) }), req.body);
    const jellyfin = store.get('jellyfin');
    if (!jellyfin) throw new HttpError(400, 'Connect Jellyfin first');
    store.set('jellyfin', { ...jellyfin, libraryIds });
    if (store.get('setupComplete')) library.trigger();
    return { ok: true };
  });

  app.post('/api/setup/jellyfin/users', async (req): Promise<ImportedProfile[]> => {
    guard(req);
    const rows = await importJellyfinUsers(store);
    return rows.map((r) => ({ ...profileFor(store, r), hidden: Boolean(r.hidden) }));
  });

  /**
   * Counts a Settings sign-in as a wrong password until Jellyfin says otherwise, or turns it down when the
   * account has had its tries. Nothing in it waits, so sign-ins sent together are counted one by one.
   */
  function takeTry(userId: string, name: string, account: JellyfinUser | null) {
    const misses = store.get('jellyfinMisses');
    let missed = misses[userId];
    // Signing in to Jellyfin itself shows the person knows the password, so the count starts again. Jellyfin's
    // date is compared with the one it gave when the count began, so a clock that's off can't start it again.
    const since = missed?.lastLoginAt;
    if (missed && account?.lastLoginAt != null && (since == null || account.lastLoginAt > since)) missed = undefined;
    const after = account?.lockoutAfter;
    const tries = passwordTries(after);
    if (tries === 0 && after != null) {
      // Not a matter of wrong passwords: one could already disable the account, whatever happens in Jellyfin.
      throw new HttpError(
        403,
        `Jellyfin disables ${name}'s account after ${after} wrong password${after === 1 ? '' : 's'}, so Curatorr ` +
          "doesn't pass on passwords for it. Sign in as another administrator, or allow more tries in Jellyfin.",
      );
    }
    // Where Jellyfin disables accounts, wrong passwords typed in its own apps bring that closer too.
    const count = Math.max(missed?.count ?? 0, account?.lockoutAfter != null ? account.wrongPasswords : 0);
    if (count >= tries) {
      throw new HttpError(429, `Too many wrong passwords for ${name}. Sign in to Jellyfin itself once, then try again here.`);
    }
    const lastLoginAt = missed ? missed.lastLoginAt : (account?.lastLoginAt ?? null);
    store.set('jellyfinMisses', { ...misses, [userId]: { count: count + 1, at: Date.now(), lastLoginAt } });
  }

  /** The sign-in wasn't an answer about the password (Jellyfin couldn't be reached, say), so it doesn't count. */
  function giveBackTry(userId: string) {
    const { [userId]: missed, ...others } = store.get('jellyfinMisses');
    if (!missed) return;
    store.set('jellyfinMisses', missed.count > 1 ? { ...others, [userId]: { ...missed, count: missed.count - 1 } } : others);
  }

  /** The right password: the account starts afresh. */
  function forgetTries(userId: string) {
    const { [userId]: _, ...others } = store.get('jellyfinMisses');
    store.set('jellyfinMisses', others);
  }

  /**
   * A Jellyfin administrator signs in to manage Curatorr on this device. Jellyfin can disable an account after a
   * few wrong passwords, so Curatorr passes on two in a row at most (fewer where Jellyfin disables it sooner), and
   * then waits until the person has signed in to Jellyfin itself.
   */
  app.post('/api/jellyfin/login', async (req, reply) => {
    const jellyfin = store.get('jellyfin');
    if (!jellyfin) throw new HttpError(409, "Curatorr isn't connected to Jellyfin");
    const body = parse(z.object({ username: username.min(1), password: password.min(1) }), req.body);
    // Only an administrator may manage Curatorr, so only their passwords go to Jellyfin: anyone else's
    // wrong ones would only count toward Jellyfin locking their account. Someone made an administrator
    // lately is one here after the next library sync, or a refresh of the profiles.
    const name = body.username.toLowerCase();
    const known = store.profileRows(true).find((p) => p.jellyfin_user_id != null && p.name.toLowerCase() === name);
    if (!known?.is_admin) throw new HttpError(403, `${body.username} isn't a Jellyfin administrator`);
    const userId = known.jellyfin_user_id!;

    // How Jellyfin locks the account and when it last signed in, as Jellyfin has them now. A read that fails
    // tells nothing, like a Jellyfin that leaves them out.
    const account = await JellyfinClient.connected(jellyfin)
      .users()
      .then((users) => users.find((u) => jellyfinIdKey(u.id) === jellyfinIdKey(userId)) ?? null)
      .catch(() => null);
    if (account?.disabled) {
      throw new HttpError(403, `Jellyfin has disabled ${known.name}'s account. Another administrator can turn it back on in Jellyfin.`);
    }
    takeTry(userId, known.name, account);

    // The sign-in only shows who it is. It gets a device of its own, because Jellyfin keeps one token
    // per device and user, and Curatorr's own must stay; and it ends straight away.
    const device = `${jellyfin.deviceId}-${randomUUID()}`;
    let signedIn: { token: string; user: JellyfinUser };
    try {
      signedIn = await new JellyfinClient(jellyfin.url, device).authenticate(body.username, body.password);
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 401) {
        throw new HttpError(400, "Jellyfin didn't accept that username and password");
      }
      giveBackTry(userId);
      if (!(err instanceof UpstreamError)) throw err;
      // Anyone can try this, so the answer doesn't say where Jellyfin is; the log does.
      req.log.warn({ err: err.message }, 'Jellyfin sign-in failed');
      if (err.status === 403) {
        throw new HttpError(
          403,
          `Jellyfin turned down ${known.name}'s sign-in. ` +
            'If it disabled the account, another administrator can turn it back on in Jellyfin.',
        );
      }
      throw new HttpError(502, "Couldn't reach Jellyfin. Try again in a moment.");
    }
    forgetTries(userId);
    const { token, user } = signedIn;
    await new JellyfinClient(jellyfin.url, device, token).logout().catch(() => {});
    if (!user.admin) throw new HttpError(403, `${user.name} isn't a Jellyfin administrator`);
    // Their name and picture as Jellyfin has them now.
    saveJellyfinProfile(store, user);
    setAdminCookie(reply, store, user.id);
    return { status: 'ok', account: { name: user.name } };
  });
};
