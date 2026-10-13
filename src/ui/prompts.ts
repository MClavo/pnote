import * as clack from '@clack/prompts';
import type { Issue, IssueInput, Project } from '../core/model.js';
import { clean } from './layout.js';

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
  return answer(await clack.text({
    message, initialValue,
    validate: required ? value => value?.trim() ? undefined : 'Enter a value.' : undefined,
  }));
}

export async function selectProject(projects: Project[]): Promise<Project> {
  const id = answer(await clack.select({
    message: 'Select a project',
    options: projects.map(project => ({ value: project.id, label: `${project.name} (${project.id})` })),
  }));
  return projects.find(project => project.id === id)!;
}

export async function edit(issue: Issue): Promise<Partial<IssueInput>> {
  const field = answer(await clack.select({
    message: `What would you like to edit? (#${issue.number} · ${clean(issue.title)})`,
    options: [
      { value: 'title', label: 'Title' },
      { value: 'description', label: 'Description' },
      { value: 'priority', label: 'low / normal / high' },
    ],
  }));
  if (field === 'title') return { title: await text('Title', issue.title) };
  if (field === 'description') return { description: await text('Description (empty clears it)', issue.description ?? '', false) };
  return { priority: answer(await clack.select({
    message: 'Select low, normal, or high', initialValue: issue.priority,
    options: [
      { value: 'low' as const, label: 'low' },
      { value: 'normal' as const, label: 'normal' },
      { value: 'high' as const, label: 'high' },
    ],
  })) };
}

export async function confirmDelete(reference: string): Promise<boolean> {
  return answer(await clack.confirm({ message: `Delete issue ${reference} and its notes?`, initialValue: false }));
}
