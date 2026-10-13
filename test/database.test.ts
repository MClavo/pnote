import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { databasePath, openDatabase } from '../src/db/database.js';
import { createIssue } from '../src/core/issues.js';
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

test('migrations initialize once, persist data and counters, and reject newer schemas', t => {
  const filename = join(temporaryDirectory(t), 'data', 'pnote.db');
  let db = openDatabase(filename);
  const project = createProject(db, 'persisted', null, '/project');
  createIssue(db, project.id, { title: 'First' }, null);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
  db.close();
  db = openDatabase(filename);
  assert.equal(createIssue(db, project.id, { title: 'Second' }, null).number, 2);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.pragma('user_version = 999');
  db.close();
  assert.throws(() => openDatabase(filename), /newer/);
});
