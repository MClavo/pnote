import * as clack from '@clack/prompts';
import type { Issue, IssueInput, Project } from '../core/model.js';
import { clean } from './layout.js';
import { editText } from './editor.js';
import { color, priorityColor } from './theme.js';

export class CancelledError extends Error {
  constructor() { super('Cancelled.'); }
}

function answer<T>(value: T): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new CancelledError();
  return value as Exclude<T, symbol>;
}

export function canPrompt(json: boolean): boolean {
  return !json && Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function text(message: string, initialValue?: string, required = true): Promise<string> {
  const value = await editText({ message, initialValue, required, multiline: false });
  if (value === undefined) throw new CancelledError();
  return value;
}

export async function multiline(message: string, initialValue?: string, required = true): Promise<string> {
  const value = await editText({ message, initialValue, required });
  if (value === undefined) throw new CancelledError();
  return value;
}

export async function selectProject(projects: Project[]): Promise<Project> {
  const id = answer(await clack.select({
    message: color.bold(color.cyan('Select a project')),
    options: projects.map(project => ({ value: project.id, label: `${project.name} (${project.id})` })),
  }));
  return projects.find(project => project.id === id)!;
}

export async function edit(issue: Issue): Promise<Partial<IssueInput>> {
  const field = answer(await clack.select({
    message: color.bold(color.cyan(`What would you like to edit? (#${issue.number} · ${clean(issue.title)})`)),
    options: [
      { value: 'title', label: color.cyan('Title') },
      { value: 'description', label: color.cyan('Description') },
      { value: 'priority', label: 'low / normal / high' },
    ],
  }));
  if (field === 'title') return { title: await text('Title', issue.title) };
  if (field === 'description') return { description: await multiline('Description (empty clears it)', issue.description ?? '', false) };
  return { priority: answer(await clack.select({
    message: color.bold(color.cyan('Select low, normal, or high')), initialValue: issue.priority,
    options: [
      { value: 'low' as const, label: priorityColor('low') },
      { value: 'normal' as const, label: priorityColor('normal') },
      { value: 'high' as const, label: priorityColor('high') },
    ],
  })) };
}

export async function confirmDelete(reference: string): Promise<boolean> {
  return answer(await clack.confirm({ message: color.bold(color.yellow(`Delete issue ${clean(reference)} and its notes?`)), initialValue: false }));
}
