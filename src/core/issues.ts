import type { Db } from '../db/database.js';
import * as queries from '../db/issues.js';
import type { Issue, IssueFilter, IssueInput, Priority } from './model.js';

export function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} cannot be empty.`);
  return trimmed;
}

export function titleText(value: string): string {
  if (/[\r\n\u2028\u2029]/u.test(value)) throw new Error('Title must be a single line.');
  return requiredText(value, 'Title');
}

export function priority(value: string): Priority {
  if (value !== 'low' && value !== 'normal' && value !== 'high') {
    throw new Error('Priority must be low, normal, or high.');
  }
  return value;
}

export function getIssue(db: Db, projectId: number, number: number) {
  const issue = queries.getIssue(db, projectId, number);
  if (!issue) throw new Error(`Issue ${projectId}:${number} does not exist.`);
  return issue;
}

export function listIssues(db: Db, filter: IssueFilter = {}) {
  if (filter.priority) priority(filter.priority);
  if (filter.search !== undefined) requiredText(filter.search, 'Search text');
  return queries.listIssues(db, filter);
}

export function createIssue(db: Db, projectId: number, input: IssueInput, commit: string | null) {
  const title = titleText(input.title);
  if (input.priority) priority(input.priority);
  return queries.insertIssue(db, projectId, { ...input, title, description: input.description || null },
    commit, new Date().toISOString());
}

export function editIssue(db: Db, issue: Issue, patch: Partial<IssueInput>) {
  if (!Object.values(patch).some(value => value !== undefined)) throw new Error('Provide at least one field to edit.');
  const validated = { ...patch };
  if (patch.title !== undefined) validated.title = titleText(patch.title);
  if (patch.priority !== undefined) validated.priority = priority(patch.priority);
  if (patch.description !== undefined) validated.description = patch.description || null;
  return queries.updateIssue(db, issue, validated, new Date().toISOString());
}

export function completeIssue(db: Db, issue: Issue, commit: string | null) {
  return queries.setStatus(db, issue, 'done', commit, new Date().toISOString());
}

export function reopenIssue(db: Db, issue: Issue) {
  return queries.setStatus(db, issue, 'open', null, new Date().toISOString());
}

export function addNote(db: Db, issue: Issue, content: string) {
  return queries.insertNote(db, issue, requiredText(content, 'Note'), new Date().toISOString());
}

export { issueNotes, deleteIssue, exportData } from '../db/issues.js';
