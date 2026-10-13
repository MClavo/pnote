import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import type { ExportData, IssueSummary, Note, Project } from '../src/core/model.js';
import { createProject } from '../src/db/projects.js';
import { databasePath, openDatabase } from '../src/db/database.js';
import { commit, directory, git, hasGit, temporaryDirectory } from './helpers.js';

const entry = fileURLToPath(new URL('../dist/cli/main.js', import.meta.url));
const execute = promisify(execFile);

function fixture(t: TestContext) {
  const root = temporaryDirectory(t);
  const cwd = directory(root, 'project with spaces');
  const other = directory(root, 'other');
  const data = join(root, 'data');
  const env = { ...process.env, XDG_DATA_HOME: data, LOCALAPPDATA: data, NO_COLOR: '1' };
  function run(args: string[], from = cwd) {
    return spawnSync(process.execPath, [entry, ...args], { cwd: from, env, encoding: 'utf8', timeout: 10000 });
  }
  function json<T>(args: string[], from = cwd): T {
    const result = run([...args, '--json'], from);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /\x1b/);
    return JSON.parse(result.stdout) as T;
  }
  return { root, cwd, other, env, run, json };
}

test('CLI supports the full issue lifecycle with clean JSON and no project writes', t => {
  const f = fixture(t);
  assert.deepEqual(f.json<Project[]>(['projects']), []);
  assert.deepEqual(f.json<IssueSummary[]>([]), []);
  let issue = f.json<IssueSummary>(['add', 'First', '--description', 'Original', '-p', 'high']);
  assert.equal(issue.number, 1);
  assert.equal(issue.priority, 'high');
  assert.equal(issue.createdCommit, null);
  const note = f.json<Note>(['note', '1', 'A note']);
  assert.equal(note.content, 'A note');
  const shown = f.json<IssueSummary & { notes: Note[] }>(['show', '1']);
  assert.equal(shown.notes.length, 1);
  issue = f.json<IssueSummary>(['edit', '1', '--title', 'Updated', '--description', '', '--priority', 'normal']);
  assert.equal(issue.title, 'Updated');
  assert.equal(issue.description, null);
  assert.equal(f.json<IssueSummary[]>(['search', 'updated']).length, 1);
  issue = f.json<IssueSummary>(['done', '1']);
  assert.equal(issue.status, 'done');
  assert.equal(f.json<IssueSummary[]>(['ls', '--done']).length, 1);
  assert.equal(f.json<IssueSummary[]>(['ls', '--open']).length, 0);
  assert.equal(f.json<IssueSummary>(['reopen', '1']).status, 'open');
  const exported = f.json<ExportData>(['export']);
  assert.equal(exported.issues.length, 1);
  assert.equal(exported.notes.length, 1);
  assert.equal(exported.paths.length, 1);
  assert.deepEqual(f.json(['rm', '1', '--force']), { deleted: true, projectId: issue.projectId, number: 1 });
  assert.equal(f.json<IssueSummary>(['add', 'Second']).number, 2);
  assert.deepEqual(readdirSync(f.cwd), []);
});

test('cross-project references work by name and ID without registering the caller directory', t => {
  const f = fixture(t);
  const original = f.json<IssueSummary>(['add', 'Original']);
  assert.equal(f.json<IssueSummary>(['show', `${original.projectName}:1`], f.other).title, 'Original');
  assert.equal(f.json<Project[]>(['projects']).length, 1);
  assert.equal(f.json<IssueSummary>(['edit', `${original.projectId}:1`, '--title', 'Changed'], f.other).title, 'Changed');
  assert.equal(f.json<IssueSummary>(['done', `${original.projectId}:1`], f.other).status, 'done');
  const second = f.json<IssueSummary>(['add', 'Other'], f.other);
  assert.equal(second.number, 1);
  assert.equal(f.json<IssueSummary>(['show', '1'], f.other).title, 'Other');
  const all = f.json<IssueSummary[]>(['ls', '-a']);
  assert.equal(all.length, 2);
  assert.ok(all.every(issue => issue.projectName && issue.number === 1));
  const human = f.run(['search', 'Changed', '-a']);
  assert.match(human.stdout, new RegExp(`${original.projectName}:1`));
  assert.equal(f.json<ExportData>(['export', '-a']).projects.length, 2);
  const linked = f.json<Project>(['project', 'link', String(original.projectId)], f.other);
  assert.equal(linked.id, original.projectId);
  assert.equal(f.json<IssueSummary>(['show', '1'], f.other).title, 'Changed');
  assert.deepEqual(readdirSync(f.other), []);
});

test('human output uses compact lists, timeline detail, and concise action feedback', t => {
  const f = fixture(t);
  const created = f.run(['add', 'Fix recovery', '-p', 'high', '--description', 'First paragraph.\n\nSecond paragraph.']);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /✓ Created .*:1 · Fix recovery \[high\]/);
  assert.doesNotMatch(created.stdout, /Created\s+\d|priority|Description|\x1b/);
  const note = f.run(['note', '1', 'First line.\nSecond line.']);
  assert.match(note.stdout, /Note added/);
  const listed = f.run([]);
  assert.match(listed.stdout, /1 issue · 1 open · 0 done/);
  assert.match(listed.stdout, /OPEN · 1/);
  assert.match(listed.stdout, /#1\s+high\s+Fix recovery/);
  const shown = f.run(['show', '1']);
  assert.match(shown.stdout, /Description\n  First paragraph\.\n  \n  Second paragraph\./);
  assert.match(shown.stdout, /Notes · 1\n  │\n  ●/);
  assert.match(shown.stdout, /  │ First line\.\n  │ Second line\./);
  assert.doesNotMatch(shown.stdout, /priority|\x1b/);
  assert.equal(f.json<IssueSummary & { notes: Note[] }>(['show', '1']).notes[0]!.content, 'First line.\nSecond line.');
  assert.match(f.run(['edit', '1', '-p', 'normal']).stdout, /Updated .* · high → normal/);
  assert.match(f.run(['done', '1']).stdout, /✓ Completed .*:1 · Fix recovery/);
  assert.match(f.run(['done', '1']).stdout, /is already done\./);
  assert.match(f.run(['reopen', '1']).stdout, /✓ Reopened/);
  assert.match(f.run(['reopen', '1']).stdout, /is already open\./);
  assert.match(f.run(['rm', '1', '-f']).stdout, /✓ Deleted/);
});

test('invalid and incomplete commands fail on stderr without prompting or mutating issues', t => {
  const f = fixture(t);
  f.json(['add', 'Keep']);
  for (const args of [
    ['add'], ['add', ' '], ['note', '1'], ['show'], ['show', '0'], ['show', '999'],
    ['edit', '1'], ['edit', '1', '--title', ' '], ['rm', '1'],
    ['ls', '--open', '--done'], ['add', 'Bad', '--priority', 'urgent'], ['search', ' '],
    ['export', '--unknown'], ['project', 'link', 'missing'], ['show', 'missing:1'],
  ]) {
    const result = f.run([...args, '--json']);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.equal(result.stdout, '', JSON.stringify(args));
    assert.ok(result.stderr, JSON.stringify(args));
    assert.doesNotMatch(result.stderr, /\x1b/);
  }
  for (const args of [['edit', '1'], ['rm', '1'], ['export']]) {
    const result = f.run(args);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
  assert.equal(f.json<IssueSummary[]>(['ls']).length, 1);
});

test('ambiguous project names fail without prompts and numeric IDs remain usable', t => {
  const f = fixture(t);
  const first = f.json<IssueSummary>(['add', 'First']);
  const db = openDatabase(databasePath(process.platform, f.env));
  createProject(db, first.projectName, null, join(f.root, 'unregistered'));
  db.close();
  const result = f.run(['show', `${first.projectName}:1`, '--json'], f.other);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /numeric project ID/);
  assert.equal(result.stdout, '');
  assert.equal(f.json<IssueSummary>(['show', `${first.projectId}:1`], f.other).title, 'First');
});

test('help and version do not create a database or register a project', t => {
  const f = fixture(t);
  for (const args of [['--help'], ['--version'], ['add', '--help']]) {
    assert.equal(f.run(args).status, 0);
  }
  assert.deepEqual(readdirSync(f.root).sort(), ['other', 'project with spaces']);
});

test('creation and completion capture actual Git snapshots without changing the repository', { skip: !hasGit }, t => {
  const f = fixture(t);
  git(f.cwd, 'init');
  const createdHash = commit(f.cwd);
  const before = git(f.cwd, 'status', '--porcelain');
  const issue = f.json<IssueSummary>(['add', 'Git issue']);
  assert.equal(issue.createdCommit, createdHash);
  const completionHash = commit(f.cwd);
  const done = f.json<IssueSummary>(['done', '1']);
  assert.equal(done.completedCommit, completionHash);
  assert.equal(done.createdCommit, createdHash);
  assert.equal(git(f.cwd, 'status', '--porcelain'), before);
  assert.deepEqual(readdirSync(f.cwd), ['.git']);
});

test('simultaneous first invocations create one project with distinct sequential issue numbers', async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) => execute(
    process.execPath, [entry, 'add', `Concurrent ${index}`, '--json'],
    { cwd: f.cwd, env: f.env, timeout: 15000 },
  )));
  const added = results.map(result => JSON.parse(result.stdout) as IssueSummary);
  assert.deepEqual(added.map(issue => issue.number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(added.map(issue => issue.projectId)).size, 1);
  assert.equal(f.json<Project[]>(['projects']).length, 1);
  assert.deepEqual(readdirSync(f.cwd), []);
});
