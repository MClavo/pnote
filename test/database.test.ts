import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { databasePath, openDatabase } from '../src/db/database.js';
import { createIssue, exportData, getIssue } from '../src/core/issues.js';
import { createProject } from '../src/db/projects.js';
import { temporaryDirectory } from './helpers.js';

test('data paths use OS conventions and ignore relative XDG paths', () => {
  assert.equal(databasePath('linux', { XDG_DATA_HOME: '/data' }, '/home/test'), '/data/pnote/pnote.db');
  assert.equal(databasePath('linux', {}, '/home/test'), '/home/test/.local/share/pnote/pnote.db');
  assert.equal(databasePath('linux', { XDG_DATA_HOME: 'relative' }, '/home/test'), '/home/test/.local/share/pnote/pnote.db');
  assert.equal(databasePath('win32', { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' }, 'C:\\Users\\Test'),
    'C:\\Users\\Test\\AppData\\Local\\pnote\\pnote.db');
  assert.equal(databasePath('win32', {}, 'C:\\Users\\Test'), 'C:\\Users\\Test\\AppData\\Local\\pnote\\pnote.db');
  assert.throws(() => databasePath('win32', { LOCALAPPDATA: 'relative' }), /absolute/);
});

test('version 1 migration preserves existing issues, notes, relationships, and counters', t => {
  const filename = join(temporaryDirectory(t), 'legacy.db');
  const legacy = new Database(filename);
  legacy.exec(readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8'));
  legacy.exec(`INSERT INTO projects(id, name, createdAt, nextIssueNumber) VALUES (3, 'legacy', '2026-01-01', 10);
    INSERT INTO project_paths(path, projectId) VALUES ('/legacy', 3);
    INSERT INTO issues(id, projectId, number, title, description, status, priority,
      createdAt, updatedAt, completedAt, createdCommit, completedCommit)
    VALUES (42, 3, 9, 'Keep', 'Original description', 'done', 'high',
      '2026-01-01', '2026-01-02', '2026-01-02', 'creation-hash', 'closure-hash');
    INSERT INTO notes(id, issueId, content, createdAt) VALUES (8, 42, 'Original note', '2026-01-02');`);
  legacy.close();
  let db = openDatabase(filename);
  const migrated = getIssue(db, 3, 9);
  assert.equal(migrated.id, 42);
  assert.equal(migrated.title, 'Keep');
  assert.equal(migrated.description, 'Original description');
  assert.equal(migrated.status, 'done');
  assert.equal(migrated.priority, 'high');
  assert.equal(migrated.createdAt, '2026-01-01');
  assert.equal(migrated.updatedAt, '2026-01-02');
  assert.equal(migrated.completedAt, '2026-01-02');
  assert.equal(migrated.createdCommit, 'creation-hash');
  assert.equal(migrated.completedCommit, 'closure-hash');
  for (const key of ['createdAgent', 'createdSession', 'completedAgent', 'completedSession'] as const) {
    assert.equal(migrated[key], null);
  }
  const exported = exportData(db);
  assert.deepEqual(exported.paths, [{ path: '/legacy', projectId: 3 }]);
  assert.deepEqual(exported.notes, [{ id: 8, issueId: 42, content: 'Original note', createdAt: '2026-01-02', agent: null, session: null }]);
  assert.equal(createIssue(db, 3, { title: 'Next' }, null, { agent: 'codex', session: 'new' }).number, 10);
  assert.equal(db.pragma('user_version', { simple: true }), 2);
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  assert.deepEqual(getIssue(db, 3, 9), migrated);
  assert.equal(getIssue(db, 3, 10).createdSession, 'new');
  const columns = db.pragma('table_info(issues)') as { name: string }[];
  assert.equal(columns.some(column => column.name === 'hasAgentActivity'), false);
});

test('migrations initialize once, persist data and counters, and reject newer schemas', t => {
  const filename = join(temporaryDirectory(t), 'data', 'pnote.db');
  let db = openDatabase(filename);
  const project = createProject(db, 'persisted', null, '/project');
  createIssue(db, project.id, { title: 'First' }, null);
  assert.equal(db.pragma('user_version', { simple: true }), 2);
  db.close();
  db = openDatabase(filename);
  assert.equal(createIssue(db, project.id, { title: 'Second' }, null).number, 2);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.pragma('user_version = 999');
  db.close();
  assert.throws(() => openDatabase(filename), /newer/);
});
