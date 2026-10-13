import { execFileSync } from 'node:child_process';

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
      windowsHide: true,
    }).trim() || null;
  } catch {
    return null;
  }
}

export function gitRoot(cwd: string): string | null {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

export function gitRemote(cwd: string): string | null {
  return git(cwd, ['config', '--get', 'remote.origin.url']);
}

export function gitHead(cwd: string): string | null {
  return git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
}
