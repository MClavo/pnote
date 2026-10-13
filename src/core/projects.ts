import { realpathSync } from 'node:fs';
import { basename, dirname, parse, resolve } from 'node:path';
import type { Db } from '../db/database.js';
import * as queries from '../db/projects.js';
import type { Project } from './model.js';
import { gitRemote, gitRoot } from './git.js';

export class AmbiguousProjectError extends Error {
  constructor(public projects: Project[], public path?: string) {
    super(`Project is ambiguous. Use a numeric project ID: ${projects.map(p => `${p.name} (${p.id})`).join(', ')}.`);
  }
}

export function normalizePath(path: string): string {
  const absolute = realpathSync(resolve(path));
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function knownProject(db: Db, path: string): Project | undefined {
  let current = path;
  while (true) {
    const project = queries.projectAtPath(db, current);
    if (project) return project;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function resolveCurrentProject(db: Db, cwd: string): Project {
  const directory = normalizePath(cwd);
  const known = knownProject(db, directory);
  if (known) return known;
  const repositoryDirectory = gitRoot(cwd) ?? realpathSync(resolve(cwd));
  const root = normalizePath(repositoryDirectory);
  const remote = gitRemote(repositoryDirectory);
  const name = basename(repositoryDirectory) || parse(repositoryDirectory).root;
  // Recheck under a write lock so simultaneous first invocations cannot create duplicates.
  return db.transaction(() => {
    const existing = knownProject(db, directory) ?? knownProject(db, root);
    if (existing) return existing;
    const byRemote = remote ? queries.matchingProjects(db, 'remote', remote) : [];
    const matches = byRemote.length ? byRemote : queries.matchingProjects(db, 'name', name);
    if (matches.length > 1) throw new AmbiguousProjectError(matches, root);
    const match = matches[0];
    if (match) {
      queries.associatePath(db, root, match.id);
      return match;
    }
    return queries.createProject(db, name, remote, root);
  }).immediate();
}

export function resolveProject(db: Db, selector: string): Project {
  if (/^\d+$/.test(selector)) {
    const id = Number(selector);
    const project = Number.isSafeInteger(id) ? queries.getProject(db, id) : undefined;
    if (!project) throw new Error(`Project ID ${selector} does not exist.`);
    return project;
  }
  const matches = queries.matchingProjects(db, 'name', selector);
  if (matches.length > 1) throw new AmbiguousProjectError(matches);
  if (!matches[0]) throw new Error(`Project ${JSON.stringify(selector)} does not exist.`);
  return matches[0];
}

export function linkProject(db: Db, cwd: string, project: Project): void {
  queries.associatePath(db, normalizePath(cwd), project.id);
}

export function parseIssueReference(reference: string): { project?: string; number: number } {
  const colon = reference.lastIndexOf(':');
  const project = colon < 0 ? undefined : reference.slice(0, colon);
  const digits = reference.slice(colon + 1);
  const number = Number(digits);
  if (!/^\d+$/.test(digits) || !Number.isSafeInteger(number) || number < 1 || project === '') {
    throw new Error('Use a positive issue number or project:number (for example mangrove:12 or 3:12).');
  }
  return { project, number };
}
