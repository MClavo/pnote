import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as issues from '../src/core/issues.js';
import { createProject } from '../src/db/projects.js';
import { memoryDb } from './helpers.js';

test('project numbering is independent and deletion never reuses a number', t => {
  const db = memoryDb(t);
  const a = createProject(db, 'a', null, '/a');
  const b = createProject(db, 'b', null, '/b');
  const first = issues.createIssue(db, a.id, { title: 'One' }, null);
  assert.equal(first.number, 1);
  assert.equal(first.priority, 'low');
  assert.equal(issues.createIssue(db, b.id, { title: 'Other project' }, null).number, 1);
  issues.addNote(db, first, 'Attached note');
  issues.deleteIssue(db, first);
  assert.deepEqual(issues.issueNotes(db, first.id), []);
  assert.equal(issues.createIssue(db, a.id, { title: 'Two' }, null).number, 2);
  assert.throws(() => issues.getIssue(db, a.id, 1), /does not exist/);
  assert.throws(() => db.prepare(`INSERT INTO issues(projectId, number, title, createdAt, updatedAt)
    VALUES (?, 2, 'Duplicate', '', '')`).run(a.id), /UNIQUE/);
});

test('failed creation rolls back the number allocation', t => {
  const db = memoryDb(t);
  const project = createProject(db, 'a', null, '/a');
  db.exec(`CREATE TRIGGER reject_issue BEFORE INSERT ON issues BEGIN SELECT RAISE(ABORT, 'rejected'); END;`);
  assert.throws(() => issues.createIssue(db, project.id, { title: 'Rejected' }, null), /rejected/);
  db.exec('DROP TRIGGER reject_issue');
  assert.equal(issues.createIssue(db, project.id, { title: 'Accepted' }, null).number, 1);
});

test('edits, chronological notes, and validation', t => {
  const db = memoryDb(t);
  const project = createProject(db, 'a', null, '/a');
  let issue = issues.createIssue(db, project.id, { title: ' First ', description: 'Description' }, null);
  assert.equal(issue.title, 'First');
  issue = issues.editIssue(db, issue, { title: 'Updated', priority: 'high', description: '' });
  assert.equal(issue.title, 'Updated');
  assert.equal(issue.priority, 'high');
  assert.equal(issue.description, null);
  const stale = issue;
  issues.editIssue(db, issue, { title: 'Changed elsewhere' });
  issue = issues.editIssue(db, stale, { priority: 'low' });
  assert.equal(issue.title, 'Changed elsewhere');
  db.prepare('UPDATE issues SET updatedAt = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', issue.id);
  const one = issues.addNote(db, issue, 'One');
  const two = issues.addNote(db, issue, 'Two');
  assert.deepEqual(issues.issueNotes(db, issue.id).map(note => note.content), ['One', 'Two']);
  assert.ok(two.id > one.id);
  assert.equal(issues.getIssue(db, project.id, 1).updatedAt, two.createdAt);
  assert.throws(() => issues.createIssue(db, project.id, { title: '  ' }, null), /empty/);
  assert.throws(() => issues.editIssue(db, issue, {}), /at least one field/);
  assert.throws(() => issues.addNote(db, issue, ' \n '), /empty/);
  assert.throws(() => issues.priority('urgent'), /low, normal, or high/);
});

test('completion and reopening are idempotent and capture new completion values', t => {
  const db = memoryDb(t);
  const project = createProject(db, 'a', null, '/a');
  const original = issues.createIssue(db, project.id, { title: 'One' }, 'a'.repeat(40));
  const done = issues.completeIssue(db, original, 'b'.repeat(40));
  assert.equal(done.status, 'done');
  assert.equal(done.createdCommit, 'a'.repeat(40));
  assert.equal(done.completedCommit, 'b'.repeat(40));
  assert.ok(done.completedAt);
  assert.deepEqual(issues.completeIssue(db, original, 'c'.repeat(40)), done);
  const reopened = issues.reopenIssue(db, done);
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.completedCommit, null);
  assert.deepEqual(issues.reopenIssue(db, done), reopened);
  assert.equal(issues.completeIssue(db, reopened, 'd'.repeat(40)).completedCommit, 'd'.repeat(40));
});

test('exports retain relationships and support current-project and all-project data', t => {
  const db = memoryDb(t);
  const a = createProject(db, 'a', null, '/a');
  const b = createProject(db, 'b', null, '/b');
  const issue = issues.createIssue(db, a.id, { title: 'One' }, null);
  issues.createIssue(db, b.id, { title: 'Two' }, null);
  issues.addNote(db, issue, 'Note');
  const scoped = issues.exportData(db, a.id);
  assert.equal(scoped.projects.length, 1);
  assert.equal(scoped.paths[0]?.projectId, a.id);
  assert.equal(scoped.issues[0]?.number, 1);
  assert.equal(scoped.notes[0]?.issueId, issue.id);
  assert.equal(issues.exportData(db).projects.length, 2);
  assert.equal(issues.exportData(db, b.id).notes.length, 0);
});
