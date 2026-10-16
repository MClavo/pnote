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


test('late Git initialization refreshes project metadata without replacing issues or their snapshots', { skip: !hasGit }, t => {
  const f = fixture(t);
  const original = f.json<IssueSummary>(['add', 'Before Git']);
  git(f.cwd, 'init');
  git(f.cwd, 'remote', 'add', 'origin', 'https://example.invalid/later.git');
  const hash = commit(f.cwd);
  const project = f.json<Project>(['project']);
  assert.equal(project.id, original.projectId);
  assert.equal(project.remote, 'https://example.invalid/later.git');
  assert.equal(f.json<IssueSummary>(['show', '1']).createdCommit, null);
  assert.equal(f.json<IssueSummary>(['add', 'After Git']).createdCommit, hash);
  git(f.cwd, 'remote', 'set-url', 'origin', 'https://example.invalid/changed.git');
  f.json(['note', '1', 'Refresh from a child'], directory(f.cwd, 'child'));
  assert.equal(f.json<Project[]>(['projects'])[0]!.remote, 'https://example.invalid/changed.git');
  assert.equal(f.json<Project[]>(['projects']).length, 1);
});


test('project output always shows remote and updates it after late Git initialization', { skip: !hasGit }, t => {
  const f = fixture(t);
  type Details = Project & { paths: { path: string }[] };
  const original = f.json<Details>(['project']);
  assert.equal(original.remote, null);
  assert.equal('git' in original, false);
  assert.match(f.run(['project']).stdout, /Remote\s+No remote configured/);
  git(f.cwd, 'init');
  const local = f.json<Details>(['project']);
  assert.equal(local.id, original.id);
  assert.equal(local.remote, null);
  assert.match(f.run(['project']).stdout, /Remote\s+No remote configured/);
  assert.doesNotMatch(f.run(['project']).stdout, /^Git\s/m);
  const child = directory(f.cwd, 'child');
  git(f.cwd, 'remote', 'add', 'origin', 'https://example.invalid/pnote.git');
  const attached = f.json<Details>(['project'], child);
  assert.equal(attached.id, original.id);
  assert.equal(attached.remote, 'https://example.invalid/pnote.git');
  assert.match(f.run(['project']).stdout, /Remote\s+https:\/\/example.invalid\/pnote.git/);
  git(f.cwd, 'remote', 'remove', 'origin');
  assert.match(f.run(['project']).stdout, /Remote\s+No remote configured/);
  assert.equal(f.json<Details>(['project']).remote, null);
  assert.match(f.run(['project', 'link', String(original.id)]).stdout, /Remote\s+No remote configured/);
});

test('agent flags preserve per-action metadata in JSON and exports without verbose terminal attribution', t => {
  const f = fixture(t);
  const created = f.json<IssueSummary>(['add', 'Agent issue', '-ag', ' openai:gpt-6.1 ', '-s', ' creation-session ']);
  assert.equal(created.createdAgent, 'openai:gpt-6.1');
  assert.equal(created.createdSession, 'creation-session');
  assert.equal(created.completedAgent, null);
  const note = f.json<Note>(['note', `${created.projectId}:1`, 'Agent note', '--agent', 'other:provider/model', '--session', 'note-session'], f.other);
  assert.equal(note.agent, 'other:provider/model');
  assert.equal(note.session, 'note-session');
  const humanNote = f.json<Note>(['note', '1', 'Human note']);
  assert.equal(humanNote.agent, null);
  assert.equal(humanNote.session, null);
  const feedback = f.run(['done', `${created.projectId}:1`, '-ag', 'codex', '-s', 'closure-session'], f.other);
  assert.equal(feedback.status, 0, feedback.stderr);
  assert.match(feedback.stdout, /Completed[^\n]+◆ AI/);
  assert.doesNotMatch(feedback.stdout, /codex|closure-session|\x1b/);
  const shown = f.json<IssueSummary & { notes: Note[] }>(['show', '1']);
  assert.equal(shown.completedAgent, 'codex');
  assert.equal(shown.completedSession, 'closure-session');
  assert.deepEqual(shown.notes, [note, humanNote]);
  assert.equal(f.json<IssueSummary>(['done', '1', '--agent', 'replacement']).completedAgent, 'codex');
  for (const args of [[], ['ls'], ['search', 'Agent'], ['show', '1']]) {
    const result = f.run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /◆ AI/);
    assert.doesNotMatch(result.stdout, /openai:gpt-6\.1|other:provider\/model|codex|creation-session|note-session|closure-session|\x1b/);
  }
  const listed = f.json<IssueSummary[]>(['ls', '-a']);
  assert.equal(listed[0]!.createdAgent, 'openai:gpt-6.1');
  assert.equal('hasAgentActivity' in listed[0]!, false);
  const exported = f.json<ExportData>(['export', '-a']);
  assert.deepEqual(Object.keys(exported), ['projects', 'paths', 'issues', 'notes']);
  assert.equal(exported.issues[0]!.createdSession, 'creation-session');
  assert.equal(exported.issues[0]!.completedSession, 'closure-session');
  assert.deepEqual(exported.notes, [note, humanNote]);
  assert.equal(f.json<Project[]>(['projects']).length, 1);
  assert.deepEqual(readdirSync(f.cwd), []);
  assert.deepEqual(readdirSync(f.other), []);
});

test('badges follow current action authorship and disappear when the sole AI closure is cleared', t => {
  const f = fixture(t);
  assert.match(f.run(['add', 'Agent creation', '--agent', 'codex']).stdout, /Created[^\n]+◆ AI/);
  assert.doesNotMatch(f.run(['note', '1', 'Human note']).stdout, /◆ AI/);
  assert.doesNotMatch(f.run(['done', '1']).stdout, /◆ AI/);
  assert.doesNotMatch(f.run(['edit', '1', '--priority', 'high']).stdout, /◆ AI/);
  assert.doesNotMatch(f.run(['reopen', '1']).stdout, /◆ AI/);
  assert.match(f.run(['note', '1', 'Agent note', '-ag', 'other']).stdout, /◆ AI/);
  f.json(['add', 'Closure only']);
  f.json(['done', '2', '--agent', 'codex', '--session', 'run']);
  assert.match(f.run(['search', 'Closure']).stdout, /◆ AI/);
  const reopened = f.json<IssueSummary>(['reopen', '2']);
  assert.equal(reopened.completedAgent, null);
  assert.equal(reopened.completedSession, null);
  assert.doesNotMatch(f.run(['search', 'Closure']).stdout, /◆ AI/);
  f.json(['done', '2']);
  assert.doesNotMatch(f.run(['show', '2']).stdout, /◆ AI/);
  assert.doesNotMatch(f.run(['search', 'Closure']).stdout, /◆ AI/);
});

test('invalid attribution flags fail before database creation or project registration', t => {
  const f = fixture(t);
  for (const command of [['add', 'Title'], ['note', '1', 'Note'], ['done', '1']]) {
    for (const flags of [
      ['--session', 'orphan'], ['--agent', ' '], ['-ag', 'codex', '-s', ' '],
      ['-a', 'codex'], ['-ag'], ['--agent'], ['--session'],
    ]) {
      const result = f.run([...command, '--json', ...flags]);
      assert.notEqual(result.status, 0, JSON.stringify([...command, ...flags]));
      assert.equal(result.stdout, '');
      assert.ok(result.stderr);
      assert.doesNotMatch(result.stderr, /\x1b/);
    }
  }
  for (const command of [['edit', '1'], ['show', '1'], ['reopen', '1'], ['rm', '1']]) {
    const result = f.run([...command, '--agent', 'codex', '--json']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown option/);
  }
  for (const command of ['add', 'note', 'done']) {
    const result = f.run([command, '--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /-ag, --agent <identifier>/);
    assert.match(result.stdout, /-s, --session <id>/);
  }
  assert.deepEqual(readdirSync(f.root).sort(), ['other', 'project with spaces']);
});
