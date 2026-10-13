import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { AmbiguousProjectError, linkProject, normalizePath, parseIssueReference, resolveCurrentProject, resolveProject } from '../src/core/projects.js';
import { gitHead } from '../src/core/git.js';
import { createProject, listProjects, projectPaths } from '../src/db/projects.js';
import { commit, directory, git, hasGit, memoryDb, temporaryDirectory } from './helpers.js';

test('plain directories and their children retain the known project', t => {
  const db = memoryDb(t);
  const cwd = directory(temporaryDirectory(t), 'plain');
  const child = directory(cwd, 'child');
  const project = resolveCurrentProject(db, cwd);
  assert.equal(project.name, 'plain');
  assert.equal(project.remote, null);
  assert.equal(resolveCurrentProject(db, child).id, project.id);
  assert.equal(listProjects(db).length, 1);
});

test('Git initialized later, changed remotes, and nested directories preserve associations', { skip: !hasGit }, t => {
  const db = memoryDb(t);
  const cwd = directory(temporaryDirectory(t), 'later');
  const project = resolveCurrentProject(db, cwd);
  git(cwd, 'init');
  git(cwd, 'remote', 'add', 'origin', 'https://example.invalid/first.git');
  assert.equal(resolveCurrentProject(db, cwd).id, project.id);
  git(cwd, 'remote', 'set-url', 'origin', 'https://example.invalid/changed.git');
  assert.equal(resolveCurrentProject(db, directory(cwd, 'nested')).id, project.id);
});

test('a preexisting directory association wins when an ancestor later becomes a repository', { skip: !hasGit }, t => {
  const db = memoryDb(t);
  const root = temporaryDirectory(t);
  const cwd = directory(root, 'child');
  const project = resolveCurrentProject(db, cwd);
  git(root, 'init');
  assert.equal(resolveCurrentProject(db, cwd).id, project.id);
});

test('recognition uses repository root, then remote before name', { skip: !hasGit }, t => {
  const db = memoryDb(t);
  const root = temporaryDirectory(t);
  const first = directory(root, 'one');
  git(first, 'init');
  git(first, 'remote', 'add', 'origin', 'git@example.invalid:project.git');
  const project = resolveCurrentProject(db, directory(first, 'src'));
  assert.equal(project.name, 'one');
  const second = directory(root, 'two');
  git(second, 'init');
  git(second, 'remote', 'add', 'origin', 'git@example.invalid:project.git');
  createProject(db, 'two', null, join(root, 'unused'));
  assert.equal(resolveCurrentProject(db, second).id, project.id);
  assert.equal(projectPaths(db, project.id).length, 2);
});

test('unambiguous names match and ambiguous names require explicit selection', t => {
  const db = memoryDb(t);
  const root = temporaryDirectory(t);
  const first = resolveCurrentProject(db, directory(root, 'one/shared'));
  assert.equal(resolveCurrentProject(db, directory(root, 'two/shared')).id, first.id);
  const duplicate = createProject(db, 'shared', null, join(root, 'other'));
  const unknown = directory(root, 'three/shared');
  assert.throws(() => resolveCurrentProject(db, unknown), AmbiguousProjectError);
  assert.throws(() => resolveProject(db, 'shared'), /numeric project ID/);
  assert.equal(resolveProject(db, String(duplicate.id)).id, duplicate.id);
  linkProject(db, unknown, duplicate);
  assert.equal(resolveCurrentProject(db, unknown).id, duplicate.id);
});

test('ambiguous remotes require selection without falling back to a matching name', { skip: !hasGit }, t => {
  const db = memoryDb(t);
  const root = temporaryDirectory(t);
  const remote = 'https://example.invalid/shared.git';
  createProject(db, 'first', remote, join(root, 'first'));
  createProject(db, 'second', remote, join(root, 'second'));
  const clone = directory(root, 'clone');
  git(clone, 'init');
  git(clone, 'remote', 'add', 'origin', remote);
  assert.throws(() => resolveCurrentProject(db, clone), AmbiguousProjectError);
});

test('optional Git handles unborn HEAD, captures commits, and tolerates missing Git', { skip: !hasGit }, t => {
  const db = memoryDb(t);
  const cwd = temporaryDirectory(t);
  git(cwd, 'init');
  assert.equal(gitHead(cwd), null);
  assert.equal(gitHead(directory(cwd, 'nested')), null);
  const hash = commit(cwd);
  assert.equal(gitHead(cwd), hash);
  assert.match(hash, /^[a-f0-9]{40,64}$/);
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.equal(gitHead(cwd), null);
    assert.equal(resolveCurrentProject(db, cwd).remote, null);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('references accept project numbers and explicit project selectors', () => {
  assert.deepEqual(parseIssueReference('12'), { project: undefined, number: 12 });
  assert.deepEqual(parseIssueReference('mangrove:12'), { project: 'mangrove', number: 12 });
  assert.deepEqual(parseIssueReference('3:12'), { project: '3', number: 12 });
  for (const value of ['0', '-1', '1.5', '1e3', ':1', 'p:0', '9007199254740992']) {
    assert.throws(() => parseIssueReference(value), /positive issue number/);
  }
});

test('path normalization resolves relative segments', t => {
  const cwd = temporaryDirectory(t);
  directory(cwd, 'child');
  assert.equal(normalizePath(join(cwd, 'child', '..')), normalizePath(cwd));
});
