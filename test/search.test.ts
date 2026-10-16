import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addNote, completeIssue, createIssue, listIssues, reopenIssue } from '../src/core/issues.js';
import { createProject } from '../src/db/projects.js';
import { memoryDb } from './helpers.js';

test('search ANDs terms across title and description, ignoring notes', t => {
  const db = memoryDb(t);
  const project = createProject(db, 'a', null, '/a');
  const match = createIssue(db, project.id, { title: 'Snapshot', description: 'Recovery failure' }, null);
  const other = createIssue(db, project.id, { title: 'Snapshot only' }, null);
  addNote(db, other, 'Recovery');
  assert.deepEqual(listIssues(db, { search: '  SNAPSHOT   recovery  ' }).map(i => i.id), [match.id]);
  assert.deepEqual(listIssues(db, { search: 'Recovery Snapshot' }).map(i => i.id), [match.id]);
  assert.deepEqual(listIssues(db, { search: 'missing' }), []);
});

test('listing activity is derived from retained creation, closure, and note attribution', t => {
  const db = memoryDb(t);
  const project = createProject(db, 'a', null, '/a');
  const human = createIssue(db, project.id, { title: 'Human' }, null);
  const creation = createIssue(db, project.id, { title: 'Creation' }, null, { agent: 'codex' });
  const note = createIssue(db, project.id, { title: 'Note' }, null);
  addNote(db, note, 'Agent activity', { agent: 'other' });
  addNote(db, note, 'Later human activity');
  const closure = completeIssue(db, createIssue(db, project.id, { title: 'Closure' }, null), null, { agent: 'other' });
  const listed = new Map(listIssues(db).map(issue => [issue.id, issue.hasAgentActivity]));
  assert.equal(listed.get(human.id), false);
  for (const issue of [creation, note, closure]) assert.equal(listed.get(issue.id), true);
  assert.equal(listIssues(db, { search: 'Note', status: 'open', projectId: project.id })[0]!.hasAgentActivity, true);
  const reopened = reopenIssue(db, closure);
  assert.equal(listIssues(db, { search: 'Closure' })[0]!.hasAgentActivity, false);
  completeIssue(db, reopened, null);
  assert.equal(listIssues(db, { search: 'Closure' })[0]!.hasAgentActivity, false);
});

test('search supports Unicode lowercasing and literal LIKE characters', t => {
  const db = memoryDb(t);
  const project = createProject(db, 'a', null, '/a');
  const literal = createIssue(db, project.id, { title: 'ÁRBOL 100% snake_case C:\\temp' }, null);
  createIssue(db, project.id, { title: 'arbol 100X snakeXcase C:temp' }, null);
  for (const search of ['árbol', '100%', 'snake_case', 'C:\\temp']) {
    assert.deepEqual(listIssues(db, { search }).map(i => i.id), [literal.id]);
  }
  assert.deepEqual(listIssues(db, { search: "' OR 1=1 --" }), []);
});

test('filters and ordering use status then creation date, with deterministic ties', t => {
  const db = memoryDb(t);
  const a = createProject(db, 'a', null, '/a');
  const b = createProject(db, 'b', null, '/b');
  const older = createIssue(db, a.id, { title: 'Old', priority: 'high' }, null);
  const newer = createIssue(db, a.id, { title: 'New', priority: 'normal' }, null);
  const done = createIssue(db, b.id, { title: 'Done' }, null);
  completeIssue(db, done, null);
  db.prepare('UPDATE issues SET createdAt = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', older.id);
  db.prepare('UPDATE issues SET createdAt = ? WHERE id = ?').run('2021-01-01T00:00:00.000Z', newer.id);
  assert.deepEqual(listIssues(db).map(i => i.id), [newer.id, older.id, done.id]);
  assert.equal(listIssues(db, { status: 'done' })[0]?.projectName, 'b');
  assert.deepEqual(listIssues(db, { projectId: a.id, priority: 'high', status: 'open' }).map(i => i.id), [older.id]);
  assert.throws(() => listIssues(db, { search: '  ' }), /empty/);
});
