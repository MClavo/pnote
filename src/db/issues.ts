import type { Db } from './database.js';
import type { Attribution, ExportData, Issue, IssueFilter, IssueInput, IssueSummary, Note, Project, ProjectPath } from '../core/model.js';

export function getIssue(db: Db, projectId: number, number: number): IssueSummary | undefined {
  return db.prepare(`SELECT issues.*, projects.name AS projectName FROM issues
    JOIN projects ON projects.id = issues.projectId WHERE projectId = ? AND number = ?`)
    .get(projectId, number) as IssueSummary | undefined;
}

export function listIssues(db: Db, filter: IssueFilter = {}): IssueSummary[] {
  const clauses: string[] = [];
  const parameters: (string | number)[] = [];
  if (filter.projectId !== undefined) {
    clauses.push('projectId = ?');
    parameters.push(filter.projectId);
  }
  if (filter.status) {
    clauses.push('status = ?');
    parameters.push(filter.status);
  }
  if (filter.priority) {
    clauses.push('priority = ?');
    parameters.push(filter.priority);
  }
  for (const term of filter.search?.trim().split(/\s+/).filter(Boolean) ?? []) {
    clauses.push(`(search_lower(title) LIKE ? ESCAPE '\\' OR search_lower(description) LIKE ? ESCAPE '\\')`);
    const pattern = `%${term.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
    parameters.push(pattern, pattern);
  }
  const rows = db.prepare(`SELECT issues.*, projects.name AS projectName,
    (issues.createdAgent IS NOT NULL OR issues.completedAgent IS NOT NULL OR
      EXISTS (SELECT 1 FROM notes WHERE notes.issueId = issues.id AND notes.agent IS NOT NULL)) AS hasAgentActivity
    FROM issues
    JOIN projects ON projects.id = issues.projectId
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, createdAt DESC, issues.id DESC`)
    .all(...parameters) as (Omit<IssueSummary, 'hasAgentActivity'> & { hasAgentActivity: number })[];
  return rows.map(row => ({ ...row, hasAgentActivity: Boolean(row.hasAgentActivity) }));
}

export function insertIssue(db: Db, projectId: number, input: IssueInput, commit: string | null, now: string, author: Attribution = {}): IssueSummary {
  return db.transaction(() => {
    const counter = db.prepare(`UPDATE projects SET nextIssueNumber = nextIssueNumber + 1
      WHERE id = ? RETURNING nextIssueNumber - 1 AS number`).get(projectId) as { number: number } | undefined;
    if (!counter) throw new Error(`Project ID ${projectId} does not exist.`);
    db.prepare(`INSERT INTO issues(projectId, number, title, description, priority, createdAt, updatedAt, createdCommit,
      createdAgent, createdSession) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      projectId, counter.number, input.title, input.description ?? null, input.priority ?? 'low', now, now, commit,
      author.agent ?? null, author.session ?? null,
    );
    return getIssue(db, projectId, counter.number)!;
  }).immediate();
}

export function updateIssue(db: Db, issue: Issue, patch: Partial<IssueInput>, now: string): IssueSummary {
  const fields = (['title', 'description', 'priority'] as const).filter(field => patch[field] !== undefined);
  db.prepare(`UPDATE issues SET ${fields.map(field => `${field} = ?`).join(', ')}, updatedAt = ? WHERE id = ?`)
    .run(...fields.map(field => patch[field]), now, issue.id);
  return getIssue(db, issue.projectId, issue.number)!;
}

export function setStatus(db: Db, issue: Issue, status: 'open' | 'done', commit: string | null, now: string, author: Attribution = {}): IssueSummary {
  // The WHERE clause preserves timestamps even when two processes complete the same issue.
  db.prepare(`UPDATE issues SET status = ?, updatedAt = ?, completedAt = ?, completedCommit = ?,
    completedAgent = ?, completedSession = ?
    WHERE id = ? AND status != ?`).run(status, now, status === 'done' ? now : null,
      status === 'done' ? commit : null, status === 'done' ? author.agent ?? null : null,
      status === 'done' ? author.session ?? null : null, issue.id, status);
  return getIssue(db, issue.projectId, issue.number)!;
}

export function issueNotes(db: Db, issueId: number): Note[] {
  return db.prepare('SELECT * FROM notes WHERE issueId = ? ORDER BY createdAt, id').all(issueId) as Note[];
}

export function insertNote(db: Db, issue: Issue, content: string, now: string, author: Attribution = {}): Note {
  return db.transaction(() => {
    const result = db.prepare('INSERT INTO notes(issueId, content, createdAt, agent, session) VALUES (?, ?, ?, ?, ?)')
      .run(issue.id, content, now, author.agent ?? null, author.session ?? null);
    db.prepare('UPDATE issues SET updatedAt = ? WHERE id = ?').run(now, issue.id);
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid) as Note;
  }).immediate();
}

export function deleteIssue(db: Db, issue: Issue): void {
  db.prepare('DELETE FROM issues WHERE id = ?').run(issue.id);
}

export function exportData(db: Db, projectId?: number): ExportData {
  return db.transaction(() => {
    const parameters = projectId === undefined ? [] : [projectId];
    const where = projectId === undefined ? '' : 'WHERE projectId = ?';
    return {
      projects: db.prepare(`SELECT id, name, remote, createdAt FROM projects
        ${projectId === undefined ? '' : 'WHERE id = ?'} ORDER BY id`).all(...parameters) as Project[],
      paths: db.prepare(`SELECT * FROM project_paths ${where} ORDER BY path`).all(...parameters) as ProjectPath[],
      issues: db.prepare(`SELECT * FROM issues ${where} ORDER BY id`).all(...parameters) as Issue[],
      notes: db.prepare(`SELECT notes.* FROM notes JOIN issues ON issues.id = notes.issueId
        ${where} ORDER BY notes.createdAt, notes.id`).all(...parameters) as Note[],
    };
  })();
}
