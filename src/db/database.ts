import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, posix, win32 } from 'node:path';

export type Db = Database.Database;

export function databasePath(
  platform = process.platform,
  env = process.env,
  home = homedir(),
): string {
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local');
    if (!win32.isAbsolute(base)) throw new Error('LOCALAPPDATA must be an absolute path.');
    return win32.join(base, 'pnote', 'pnote.db');
  }
  const base = env.XDG_DATA_HOME && posix.isAbsolute(env.XDG_DATA_HOME)
    ? env.XDG_DATA_HOME : posix.join(home, '.local', 'share');
  return posix.join(base, 'pnote', 'pnote.db');
}

const migrations = [
  `CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    remote TEXT,
    createdAt TEXT NOT NULL,
    nextIssueNumber INTEGER NOT NULL DEFAULT 1 CHECK(nextIssueNumber > 0)
  );
  CREATE TABLE project_paths (
    path TEXT PRIMARY KEY,
    projectId INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK(number > 0),
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done')),
    priority TEXT NOT NULL DEFAULT 'low' CHECK(priority IN ('low', 'normal', 'high')),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    completedAt TEXT,
    createdCommit TEXT,
    completedCommit TEXT,
    UNIQUE(projectId, number)
  );
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issueId INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    createdAt TEXT NOT NULL
  );
  CREATE INDEX notes_issue ON notes(issueId, createdAt, id);
  CREATE INDEX projects_name ON projects(name);
  CREATE INDEX projects_remote ON projects(remote);
  CREATE INDEX paths_project ON project_paths(projectId);
  CREATE INDEX issues_listing ON issues(projectId, status, createdAt);`,
  `ALTER TABLE issues ADD COLUMN createdAgent TEXT;
  ALTER TABLE issues ADD COLUMN createdSession TEXT;
  ALTER TABLE issues ADD COLUMN completedAgent TEXT;
  ALTER TABLE issues ADD COLUMN completedSession TEXT;
  ALTER TABLE notes ADD COLUMN agent TEXT;
  ALTER TABLE notes ADD COLUMN session TEXT;`,
];

export function openDatabase(filename = databasePath()): Db {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.function('search_lower', { deterministic: true }, (value: unknown) =>
      typeof value === 'string' ? value.toLowerCase() : '');
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true }) as number;
      if (version > migrations.length) throw new Error('Database is newer than this version of PNote.');
      for (let i = version; i < migrations.length; i++) {
        db.exec(migrations[i]!);
        db.pragma(`user_version = ${i + 1}`);
      }
    }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
