#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { openDatabase, type Db } from '../db/database.js';
import { associatePath, listProjects, projectPaths } from '../db/projects.js';
import * as issues from '../core/issues.js';
import { gitHead } from '../core/git.js';
import { AmbiguousProjectError, linkProject, parseIssueReference, resolveCurrentProject, resolveProject } from '../core/projects.js';
import type { IssueFilter, IssueInput, Project } from '../core/model.js';
import * as prompts from '../ui/prompts.js';
import * as render from '../ui/render.js';
import { errorColor } from '../ui/theme.js';
import { clean } from '../ui/layout.js';

interface Options {
  json?: boolean;
  all?: boolean;
  open?: boolean;
  done?: boolean;
  force?: boolean;
  title?: string;
  description?: string;
  priority?: string;
  agent?: string;
  session?: string;
}

async function main(): Promise<void> {
  const program = new Command().name('pno').description('Local project issues and notes').version('0.1.0');
  program.exitOverride().showHelpAfterError();
  let database: Db | undefined;
  const db = () => database ??= openDatabase();
  const cwd = process.cwd();

  function command(name: string, description: string, isDefault = false): Command {
    return program.command(name, { isDefault }).description(description).option('-j, --json', 'Output JSON');
  }

  function output(options: Options, data: unknown, human: () => string): void {
    console.log(options.json ? JSON.stringify(data) : human());
  }

  async function input(value: string | undefined, label: string, options: Options, multiline = false): Promise<string> {
    if (value !== undefined) return issues.requiredText(value, label);
    if (!prompts.canPrompt(Boolean(options.json))) throw new Error(`${label} is required. See --help.`);
    return multiline ? prompts.multiline(label) : prompts.text(label);
  }

  async function choose(resolve: () => Project, options: Options): Promise<Project> {
    try {
      return resolve();
    } catch (error) {
      if (!(error instanceof AmbiguousProjectError) || !prompts.canPrompt(Boolean(options.json))) throw error;
      const project = await prompts.selectProject(error.projects);
      if (error.path) associatePath(db(), error.path, project.id);
      return project;
    }
  }

  const currentProject = (options: Options) => choose(() => resolveCurrentProject(db(), cwd), options);
  const selectedProject = (selector: string, options: Options) => choose(() => resolveProject(db(), selector), options);

  async function issueFrom(reference: string | undefined, options: Options) {
    const parsed = parseIssueReference(await input(reference, 'Issue reference', options));
    const project = parsed.project ? await selectedProject(parsed.project, options) : await currentProject(options);
    return issues.getIssue(db(), project.id, parsed.number);
  }

  function listOptions(cmd: Command): Command {
    return cmd.option('-a, --all', 'Include all projects')
      .option('-o, --open', 'Only open issues').option('-d, --done', 'Only completed issues')
      .option('-p, --priority <priority>', 'Filter by low, normal, or high priority', issues.priority);
  }

  function agentOptions(cmd: Command): Command {
    const agent = cmd.createOption('--agent <identifier>', 'Attribute this action to an agent');
    // Commander parses exact aliases, but its constructor only accepts single-letter short flags.
    agent.short = '-ag';
    agent.flags = '-ag, --agent <identifier>';
    return cmd.addOption(agent)
      .option('-s, --session <id>', 'Agent session ID; requires --agent');
  }

  async function list(options: Options, search?: string): Promise<void> {
    if (options.open && options.done) throw new Error('--open and --done are mutually exclusive.');
    const project = options.all ? undefined : await currentProject(options);
    const filter: IssueFilter = {
      projectId: project?.id, priority: options.priority ? issues.priority(options.priority) : undefined,
      status: options.open ? 'open' : options.done ? 'done' : undefined, search,
    };
    const result = issues.listIssues(db(), filter);
    output(options, result.map(({ hasAgentActivity, ...issue }) => issue), () => render.issueList(result, Boolean(options.all), project, {
      search, status: filter.status, priority: filter.priority,
    }));
  }

  listOptions(command('ls', 'List issues', true)).action((options: Options) => list(options));

  agentOptions(command('add [title]', 'Create an issue'))
    .option('-p, --priority <priority>', 'low, normal, or high', issues.priority)
    .option('--description <text>', 'Issue description')
    .action(async (value: string | undefined, options: Options) => {
      const author = issues.attribution(options);
      const title = await input(value, 'Title', options);
      const project = await currentProject(options);
      const issue = issues.createIssue(db(), project.id, {
        title, description: options.description,
        priority: options.priority ? issues.priority(options.priority) : undefined,
      }, gitHead(cwd), author);
      output(options, issue, () => render.issueAction('Created', issue, `${issue.title} [${issue.priority}]`, issue.createdAgent !== null));
    });

  command('show [reference]', 'Show issue details and notes')
    .action(async (reference: string | undefined, options: Options) => {
      const issue = await issueFrom(reference, options);
      const notes = issues.issueNotes(db(), issue.id);
      output(options, { ...issue, notes }, () => render.issueDetail(issue, notes));
    });

  command('edit [reference]', 'Edit an issue')
    .option('--title <text>', 'New title').option('--description <text>', 'New description; empty clears it')
    .option('-p, --priority <priority>', 'low, normal, or high', issues.priority)
    .action(async (reference: string | undefined, options: Options) => {
      let patch: Partial<IssueInput> = {
        title: options.title, description: options.description,
        priority: options.priority ? issues.priority(options.priority) : undefined,
      };
      const hasFields = Object.values(patch).some(value => value !== undefined);
      if (!hasFields && !prompts.canPrompt(Boolean(options.json))) {
        throw new Error('Provide --title, --description, or --priority to edit without prompts.');
      }
      if (patch.title !== undefined) issues.titleText(patch.title);
      const issue = await issueFrom(reference, options);
      if (!hasFields) patch = await prompts.edit(issue);
      const result = issues.editIssue(db(), issue, patch);
      output(options, result, () => render.issueEdited(issue, result));
    });

  agentOptions(command('note [reference] [text]', 'Append a timestamped note'))
    .action(async (reference: string | undefined, value: string | undefined, options: Options) => {
      const author = issues.attribution(options);
      const content = await input(value, 'Note text', options, true);
      const issue = await issueFrom(reference, options);
      const note = issues.addNote(db(), issue, content, author);
      output(options, note, () => render.noteAdded(issue, note));
    });

  listOptions(command('search [text]', 'Search titles and descriptions'))
    .action(async (value: string | undefined, options: Options) => {
      const query = await input(value, 'Search text', options);
      await list(options, query);
    });

  agentOptions(command('done [reference]', 'Complete an issue'))
    .action(async (reference: string | undefined, options: Options) => {
      const author = issues.attribution(options);
      const issue = await issueFrom(reference, options);
      const result = issues.completeIssue(db(), issue, gitHead(cwd), author);
      output(options, result, () => issue.status === result.status
        ? render.unchanged(result) : render.issueAction('Completed', result, undefined, result.completedAgent !== null));
    });

  command('reopen [reference]', 'Reopen a completed issue')
    .action(async (reference: string | undefined, options: Options) => {
      const issue = await issueFrom(reference, options);
      const result = issues.reopenIssue(db(), issue);
      output(options, result, () => issue.status === result.status
        ? render.unchanged(result) : render.issueAction('Reopened', result));
    });

  command('rm [reference]', 'Delete an issue and its notes')
    .option('-f, --force', 'Skip confirmation')
    .action(async (reference: string | undefined, options: Options) => {
      if (!options.force && !prompts.canPrompt(Boolean(options.json))) {
        throw new Error('Deletion without an interactive terminal requires --force.');
      }
      const issue = await issueFrom(reference, options);
      if (!options.force && !await prompts.confirmDelete(render.reference(issue))) throw new prompts.CancelledError();
      issues.deleteIssue(db(), issue);
      output(options, { deleted: true, projectId: issue.projectId, number: issue.number },
        () => render.issueAction('Deleted', issue));
    });

  const projectCommand = command('project', 'Show the current project');
  projectCommand.action(async (options: Options) => {
    const project = await currentProject(options);
    const paths = projectPaths(db(), project.id);
    output(options, { ...project, paths }, () => render.projectDetail(project, paths));
  });
  projectCommand.command('link [selector]').description('Associate this directory with a project')
    .option('-j, --json', 'Output JSON')
    .action(async (value: string | undefined, local: Options) => {
      const options = { ...projectCommand.opts<Options>(), ...local };
      const selector = await input(value, 'Project name or ID', options);
      const project = await selectedProject(selector, options);
      linkProject(db(), cwd, project);
      const paths = projectPaths(db(), project.id);
      output(options, { ...project, paths }, () => render.projectDetail(project, paths));
    });

  command('projects', 'List registered projects').action((options: Options) => {
    const projects = listProjects(db());
    output(options, projects, () => render.projectList(projects));
  });

  command('export', 'Export projects, paths, issues, and notes')
    .option('-a, --all', 'Export all projects')
    .action(async (options: Options) => {
      if (!options.json) throw new Error('Export requires --json.');
      const project = options.all ? undefined : await currentProject(options);
      output(options, issues.exportData(db(), project?.id), () => '');
    });

  try {
    await program.parseAsync();
  } finally {
    database?.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
  } else {
    const cancelled = error instanceof prompts.CancelledError;
    console.error(cancelled ? errorColor.dim('Cancelled.')
      : `${errorColor.bold(errorColor.red('Error:'))} ${clean(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = cancelled ? 130 : 1;
  }
});
