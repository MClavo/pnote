import type { Db } from './database.js';
import type { Project, ProjectPath } from '../core/model.js';

const columns = 'id, name, remote, createdAt';

export function listProjects(db: Db): Project[] {
  return db.prepare(`SELECT ${columns} FROM projects ORDER BY name, id`).all() as Project[];
}

export function getProject(db: Db, id: number): Project | undefined {
  return db.prepare(`SELECT ${columns} FROM projects WHERE id = ?`).get(id) as Project | undefined;
}

export function matchingProjects(db: Db, field: 'name' | 'remote', value: string): Project[] {
  return db.prepare(`SELECT ${columns} FROM projects WHERE ${field} = ? ORDER BY id`).all(value) as Project[];
}

export function projectAtPath(db: Db, path: string): Project | undefined {
  const row = db.prepare('SELECT projectId FROM project_paths WHERE path = ?').get(path) as ProjectPath | undefined;
  return row ? getProject(db, row.projectId) : undefined;
}

export function associatePath(db: Db, path: string, projectId: number): void {
  db.prepare(`INSERT INTO project_paths(path, projectId) VALUES (?, ?)
    ON CONFLICT(path) DO UPDATE SET projectId = excluded.projectId`).run(path, projectId);
}

export function createProject(db: Db, name: string, remote: string | null, path: string): Project {
  return db.transaction(() => {
    const result = db.prepare('INSERT INTO projects(name, remote, createdAt) VALUES (?, ?, ?)')
      .run(name, remote, new Date().toISOString());
    const project = getProject(db, Number(result.lastInsertRowid))!;
    associatePath(db, path, project.id);
    return project;
  }).immediate();
}

export function projectPaths(db: Db, projectId: number): ProjectPath[] {
  return db.prepare('SELECT path, projectId FROM project_paths WHERE projectId = ? ORDER BY path')
    .all(projectId) as ProjectPath[];
}
