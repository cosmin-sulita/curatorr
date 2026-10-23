import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from './db.js';

// Windows has no POSIX modes; CI runs these on Linux.
const posix = process.platform !== 'win32';

describe('the database file', () => {
  const opened: { db: DB; dir: string }[] = [];
  afterEach(() => {
    for (const { db, dir } of opened.splice(0)) {
      try {
        db.close();
      } catch {
        // Closed already.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const open = (dir = mkdtempSync(path.join(tmpdir(), 'curatorr-db-'))) => {
    const db = openDb(dir, 'test.db');
    opened.push({ db, dir });
    return { db, dir };
  };
  /** The permission bits of the database and the -wal and -shm files SQLite keeps beside it while it's open. */
  const modes = (dir: string) =>
    ['test.db', 'test.db-wal', 'test.db-shm'].map((f) => (statSync(path.join(dir, f)).mode & 0o777).toString(8));

  it.skipIf(!posix)("is readable by Curatorr's user only, with its -wal and -shm files", () => {
    const { db, dir } = open();
    db.exec('CREATE TABLE IF NOT EXISTS probe (x); INSERT INTO probe VALUES (1)');
    expect(modes(dir)).toEqual(['600', '600', '600']);
  });

  it.skipIf(!posix)('makes a database others could read private when Curatorr opens it', () => {
    const first = open();
    first.db.close();
    chmodSync(path.join(first.dir, 'test.db'), 0o644);
    const { db, dir } = open(first.dir);
    db.exec('CREATE TABLE IF NOT EXISTS probe (x); INSERT INTO probe VALUES (1)');
    expect(modes(dir)).toEqual(['600', '600', '600']);
  });
});
