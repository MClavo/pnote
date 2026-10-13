import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { openDatabase } from '../src/db/database.js';

export function memoryDb(t: TestContext) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  return db;
}

export function temporaryDirectory(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'pnote-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export function directory(root: string, name: string) {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  return path;
}

export const hasGit = spawnSync('git', ['--version']).status === 0;

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
  }).trim();
}

export function commit(cwd: string): string {
  git(cwd, '-c', 'user.name=PNote Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', 'commit', '--allow-empty', '-m', 'Fixture');
  return git(cwd, 'rev-parse', 'HEAD');
}
