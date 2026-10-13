import pc from 'picocolors';
import type { IssueSummary, Note, Project, ProjectPath } from '../core/model.js';

const color = pc.createColors(pc.isColorSupported && Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env));

function timestamp(value: string): string {
  return new Date(value).toLocaleString();
}

// Keep user-supplied control sequences from changing the terminal's state.
function clean(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

export function reference(issue: IssueSummary): string {
  return `${clean(issue.projectName)}:${issue.number}`;
}

function row(issue: IssueSummary, all: boolean): string {
  const label = all ? reference(issue) : `#${issue.number}`;
  const priority = issue.priority === 'high' ? color.red('HIGH')
    : issue.priority === 'normal' ? color.yellow('NORMAL') : color.dim('LOW');
  const title = issue.status === 'done' ? color.green(clean(issue.title)) : clean(issue.title);
  return `  ${color.cyan(label)}  ${priority}  ${title}  ${color.dim(timestamp(issue.createdAt))}`;
}

export function issueList(issues: IssueSummary[], all: boolean, project?: Project): string {
  const lines = project ? [color.bold(color.cyan(clean(project.name)))] : [];
  if (!issues.length) return [...lines, color.dim('No issues found.')].join('\n');
  for (const status of ['open', 'done'] as const) {
    const group = issues.filter(issue => issue.status === status);
    if (group.length) {
      lines.push(status === 'done' ? color.green('DONE') : color.bold('OPEN'));
      lines.push(...group.map(issue => row(issue, all)));
    }
  }
  lines.push(color.dim(`${issues.length} issue${issues.length === 1 ? '' : 's'}`));
  return lines.join('\n');
}

export function issueDetail(issue: IssueSummary, notes: Note[] = []): string {
  const lines = [row(issue, true), `Status: ${issue.status}`, color.dim(`Created: ${timestamp(issue.createdAt)}`),
    color.dim(`Updated: ${timestamp(issue.updatedAt)}`)];
  if (issue.description) lines.push('', clean(issue.description));
  if (issue.createdCommit) lines.push(color.dim(`Creation commit: ${issue.createdCommit.slice(0, 8)}`));
  if (issue.completedAt) lines.push(color.dim(`Completed: ${timestamp(issue.completedAt)}`));
  if (issue.completedCommit) lines.push(color.dim(`Completion commit: ${issue.completedCommit.slice(0, 8)}`));
  if (notes.length) lines.push('', color.bold('Notes'), ...notes.map(note =>
    `  ${color.dim(timestamp(note.createdAt))}  ${clean(note.content)}`));
  return lines.join('\n');
}

export function projectDetail(project: Project, paths: ProjectPath[]): string {
  return [color.bold(color.cyan(clean(project.name))), color.dim(`ID: ${project.id}`),
    ...(project.remote ? [`Remote: ${clean(project.remote)}`] : []),
    ...paths.map(path => color.dim(clean(path.path)))].join('\n');
}

export function projectList(projects: Project[]): string {
  return projects.length ? projects.map(project => `${project.id}  ${color.cyan(clean(project.name))}`).join('\n')
    : color.dim('No projects registered.');
}

export function noteAdded(issue: IssueSummary, note: Note): string {
  return `Note added to ${reference(issue)}: ${clean(note.content)}`;
}
