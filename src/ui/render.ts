import type { IssueSummary, Note, Priority, Project, ProjectPath, Status } from '../core/model.js';
import { clean, displayWidth, pad, terminalWidth, wrap } from './layout.js';

import { aiBadge, color, priorityColor as level } from './theme.js';

function markAI(line: string, agent: boolean, format = (value: string) => value): string {
  // A nonbreaking space keeps the generated badge together while wrapping.
  return agent && line.endsWith('◆\u00a0AI')
    ? format(line.slice(0, -4)) + aiBadge() : format(line);
}

function timestamp(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function shortDate(value: string): string {
  const date = new Date(value);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : noun === 'match' ? 'es' : 's'}`;
}

export function reference(issue: IssueSummary): string {
  return `${clean(issue.projectName)}:${issue.number}`;
}

export interface ListContext {
  search?: string;
  status?: Status;
  priority?: Priority;
}

export function issueList(issues: IssueSummary[], all: boolean, project?: Project,
  context: ListContext = {}, width = terminalWidth()): string {
  const scope = project ? clean(project.name) : 'All projects';
  const open = issues.filter(issue => issue.status === 'open').length;
  const filtered = context.search !== undefined || context.status !== undefined || context.priority !== undefined;
  const summary = filtered ? count(issues.length, context.search !== undefined ? 'match' : 'result')
    : `${count(issues.length, 'issue')} · ${open} open · ${issues.length - open} done`;
  const heading = context.search !== undefined ? `Search "${clean(context.search)}"` : scope;
  const metadata = [context.search !== undefined ? scope : undefined, context.status, context.priority, summary]
    .filter(Boolean).join(' · ');
  const lines = displayWidth(`${heading}  ${metadata}`) <= width
    ? [`${color.bold(color.cyan(heading))}  ${color.dim(metadata)}`]
    : [...wrap(heading, width).map(line => color.bold(color.cyan(line))),
      ...wrap(metadata, width).map(line => color.dim(line))];

  if (!issues.length) {
    lines.push('', filtered ? 'No matching issues.' : 'No issues yet.',
      ...wrap(filtered ? 'Try fewer search terms or remove a filter.' : 'Create one: pno add "Your first issue"', width)
        .map(line => color.dim(line)));
    return lines.join('\n');
  }

  const label = (issue: IssueSummary) => all ? reference(issue) : `#${issue.number}`;
  const referenceWidth = Math.max(5, ...issues.map(issue => displayWidth(label(issue))));
  const dateWidth = Math.max(7, ...issues.map(issue => displayWidth(shortDate(issue.createdAt))));
  const hasAgent = (issue: IssueSummary) => Boolean(issue.hasAgentActivity || issue.createdAgent || issue.completedAgent);
  const titleText = (issue: IssueSummary) => clean(issue.title) + (hasAgent(issue) ? ' ◆\u00a0AI' : '');
  const titleWidth = Math.min(Math.max(20, ...issues.map(issue => displayWidth(titleText(issue)))),
    width - (2 + referenceWidth + 2 + 8 + 2 + 2 + dateWidth));
  const stacked = titleWidth < 20;
  let hasHeader = false;

  for (const status of ['open', 'done'] as const) {
    const group = issues.filter(issue => issue.status === status);
    if (!group.length) continue;
    lines.push('', status === 'done' ? color.green(`DONE · ${group.length}`) : color.bold(`OPEN · ${group.length}`));
    if (!stacked && !hasHeader) {
      lines.push(color.dim(`  ${pad('ISSUE', referenceWidth)}  ${pad('PRIORITY', 8)}  ${pad('TITLE', titleWidth)}  CREATED`));
      hasHeader = true;
    }
    for (const issue of group) {
      if (stacked) {
        lines.push(...wrap(label(issue), width - 2).map(line => `  ${color.cyan(line)}`),
          ...wrap(`${issue.priority} · created ${shortDate(issue.createdAt)}`, width - 2)
            .map(line => `  ${color.dim(line)}`),
          ...wrap(titleText(issue), width - 2).map(line => `  ${markAI(line, hasAgent(issue))}`));
      } else {
        const title = wrap(titleText(issue), titleWidth).map(line => markAI(line, hasAgent(issue)));
        lines.push(`  ${pad(color.cyan(label(issue)), referenceWidth)}  ${pad(level(issue.priority), 8)}  ${pad(title[0]!, titleWidth)}  ${color.dim(shortDate(issue.createdAt))}`,
          ...title.slice(1).map(line => `${' '.repeat(2 + referenceWidth + 2 + 8 + 2)}${line}`));
      }
    }
  }
  return lines.join('\n');
}

export function issueDetail(issue: IssueSummary, notes: Note[] = [], width = terminalWidth()): string {
  const header = `${reference(issue)} / ${issue.status} / ${issue.priority}`;
  const lines = displayWidth(header) <= width
    ? [`${color.cyan(reference(issue))} ${color.dim(`/ ${issue.status} /`)} ${level(issue.priority)}`]
    : [...wrap(reference(issue), width).map(line => color.cyan(line)), `${issue.status} / ${level(issue.priority)}`];
  lines.push(...wrap(clean(issue.title), width).map(line => color.bold(line)));
  if (issue.description) lines.push('', color.bold(color.cyan('Description')),
    ...wrap(clean(issue.description, true), width - 2).map(line => `  ${line}`));
  lines.push('', color.bold(color.cyan(`Notes · ${notes.length}`)));
  if (!notes.length) lines.push(color.dim('  No notes yet.'));
  else {
    lines.push(color.dim('  │'));
    for (const note of notes) {
      const dates = wrap(timestamp(note.createdAt) + (note.agent ? ' ◆\u00a0AI' : ''), width - 4);
      lines.push(`  ${color.cyan('●')} ${markAI(dates[0]!, Boolean(note.agent), color.dim)}`,
        ...dates.slice(1).map(line => `  ${color.dim('│')} ${markAI(line, Boolean(note.agent), color.dim)}`),
        ...wrap(clean(note.content, true), width - 4).map(line => `  ${color.dim('│')} ${line}`),
        color.dim('  │'));
    }
    lines[lines.length - 1] = color.dim('  ╵');
  }
  lines.push('');
  const field = (label: string, value: string, agent = false) => {
    lines.push(...wrap(`${pad(label, 19)}${value}${agent ? ' ◆\u00a0AI' : ''}`, width).map(line => markAI(line, agent, color.dim)));
  };
  field('Created', timestamp(issue.createdAt), Boolean(issue.createdAgent));
  field('Updated', timestamp(issue.updatedAt));
  if (issue.createdCommit) field('Git at creation', issue.createdCommit.slice(0, 8));
  if (issue.completedAt) field('Completed', timestamp(issue.completedAt), Boolean(issue.completedAgent));
  if (issue.completedCommit) field('Git at completion', issue.completedCommit.slice(0, 8));
  return lines.join('\n');
}

export function issueAction(action: string, issue: IssueSummary, detail?: string, agent = false): string {
  const ref = reference(issue);
  return wrap(`✓ ${action} ${ref} · ${clean(detail ?? issue.title)}${agent ? ' ◆\u00a0AI' : ''}`, terminalWidth())
    .map((line, index) => {
      const styled = markAI(line.replace(ref, () => color.cyan(ref)), agent);
      return index === 0
        ? color.green(styled.slice(0, 1)) + styled.slice(1).replace(action, () => color.bold(color.green(action)))
        : styled;
    }).join('\n');
}

export function issueEdited(before: IssueSummary, after: IssueSummary): string {
  const changes = [
    before.title !== after.title ? 'title updated' : undefined,
    before.description !== after.description ? (after.description ? 'description updated' : 'description cleared') : undefined,
    before.priority !== after.priority ? `${before.priority} → ${after.priority}` : undefined,
  ].filter(Boolean);
  return issueAction(changes.length ? 'Updated' : 'Unchanged', after, changes.length ? changes.join(' · ') : undefined);
}

export function unchanged(issue: IssueSummary): string {
  return wrap(`${reference(issue)} is already ${issue.status}.`, terminalWidth()).map(line => color.dim(line)).join('\n');
}

export function projectDetail(project: Project, paths: ProjectPath[], width = terminalWidth()): string {
  const name = clean(project.name);
  const metadata = `· project ${project.id}`;
  const lines = displayWidth(`${name} ${metadata}`) <= width
    ? [`${color.bold(color.cyan(name))} ${color.dim(metadata)}`]
    : [...wrap(name, width).map(line => color.bold(color.cyan(line))),
      ...wrap(metadata, width).map(line => color.dim(line))];
  lines.push('');
  const field = (label: string, value: string, muted = false) => {
    const content = wrap(value, width - 8);
    lines.push(...content.map((line, index) => {
      const prefix = index === 0 ? pad(color.cyan(label), 8) : ' '.repeat(8);
      return prefix + (muted ? color.dim(line) : line);
    }));
  };
  if (paths.length) {
    paths.forEach((path, index) => field(index === 0 ? 'Paths' : '', clean(path.path)));
  } else {
    field('Paths', 'No associated paths', true);
  }
  field('Remote', project.remote ? clean(project.remote) : 'No remote configured', !project.remote);
  return lines.join('\n');
}

export function projectList(projects: Project[]): string {
  if (!projects.length) return color.dim('No projects registered.');
  const idWidth = Math.max(2, ...projects.map(project => String(project.id).length));
  return [color.bold(color.cyan('Projects')) + `  ${color.dim(count(projects.length, 'project'))}`, '',
    color.dim(`  ${pad('ID', idWidth)}  NAME`),
    ...projects.map(project => `  ${pad(color.cyan(String(project.id)), idWidth)}  ${clean(project.name)}`)]
    .join('\n');
}

export function noteAdded(issue: IssueSummary, note: Note): string {
  return [...wrap(`✓ Note added to ${reference(issue)}${note.agent ? ' ◆\u00a0AI' : ''}`, terminalWidth()).map(line =>
    markAI(line, Boolean(note.agent)).replace('✓', () => color.green('✓')).replace('Note added to', () => color.bold(color.green('Note added to')))
      .replace(reference(issue), () => color.cyan(reference(issue)))),
    ...wrap(clean(note.content, true), terminalWidth() - 2).map(line => `  ${line}`)].join('\n');
}
