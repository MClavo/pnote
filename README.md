# PNote

Local project issues and notes, available as `pno`. All data stays in one SQLite database outside your development projects. Git is optional.

## Install

Use Node.js 24 or 26 and pnpm 12. The `.node-version` file selects Node.js 26 for development. From this folder:

```sh
pnpm install
pnpm build
pnpm add --global .
```

Then run `pno` from any project directory. No initialization is needed. On PowerShell, the same commands work; pnpm generates the executable shim. Your pnpm global executable directory must be on `PATH` (`pnpm setup` configures it if needed).

`better-sqlite3` uses a native binary. After changing Node major versions, run `pnpm install --force` to install the matching binary. Native builds for `better-sqlite3` and `esbuild` are allowed in `pnpm-workspace.yaml`; installations without a compatible prebuilt binary require a C++ build toolchain.

## Quick start

```sh
pno add "Fix recovery" -p high --description "Fails after restart"
pno                         # List this project's issues
pno show 1                  # Details and notes
pno note 1 "Reproduced on Windows"
pno edit 1 --priority normal
pno done 1
```

## Commands

Quote text containing spaces. `<issue>` means a project-scoped number or a `project:number` reference (see below).

| Command | What it does |
| --- | --- |
| `pno` / `pno ls` | List the current project's issues |
| `pno add "Title"` | Create an open issue; default priority is `low` |
| `pno show <issue>` | Show details, chronological notes, and Git snapshots |
| `pno edit <issue>` | Choose a field to edit interactively, or supply field flags |
| `pno note <issue> "Text"` | Append a timestamped note |
| `pno search "text"` | Search titles and descriptions |
| `pno done <issue>` | Complete an issue |
| `pno reopen <issue>` | Reopen an issue and clear completion metadata |
| `pno rm <issue>` | Delete an issue and its notes, with confirmation |
| `pno project` | Show the current project's name, ID, paths and origin remote |
| `pno projects` | List registered projects and their IDs |
| `pno project link <name\|id>` | Associate this directory with an existing project |
| `pno export --json` | Export this project's data |
| `pno help [command]` | Show general help or help for a command |

## Flags and shortcuts

Place flags after the command. For the default list, `pno -o` is equivalent to `pno ls --open`.

| Short | Long | Available on | Meaning |
| --- | --- | --- | --- |
| `-a` | `--all` | `ls`, `search`, `export` | Include all projects |
| `-o` | `--open` | `ls`, `search` | Only open issues |
| `-d` | `--done` | `ls`, `search` | Only completed issues |
| `-p <value>` | `--priority <value>` | `add`, `edit`, `ls`, `search` | Set or filter priority: `low`, `normal`, `high` |
| `-j` | `--json` | All data commands above | Output JSON without prompts or colors |
| `-f` | `--force` | `rm` | Skip deletion confirmation |
| — | `--title <text>` | `edit` | Set the title |
| — | `--description <text>` | `add`, `edit` | Set the description; `""` clears it |
| `-h` | `--help` | Any command | Show help, e.g. `pno edit -h` |
| `-V` | `--version` | `pno` | Show the version; uppercase `V` |

`--open` and `--done` cannot be combined. Short boolean flags can be grouped: `pno ls -aoj` means `pno ls --all --open --json`. `ls` and `rm` are the actual command names; there are no `list` or `remove` aliases.

```sh
pno ls -o -p high
pno edit 1 --title "Fix startup" --description "New details" -p normal
pno edit 1 --description ""
pno search "recovery restart" -a
pno rm 1 -f
```

## Projects and issue numbers

Each project has its own issue numbers, starting at 1. Deleted numbers are never reused.

| Reference | Meaning |
| --- | --- |
| `12` | Issue #12 in the current project |
| `mangrove:12` | Issue #12 in the project named `mangrove`, from any directory |
| `3:12` | Issue #12 in project ID 3, from any directory |

Every issue command accepts these forms, e.g. `pno show mangrove:12` or `pno done 3:12`. Numeric project selectors always mean project IDs. If a name is ambiguous, use its ID from `pno projects`. Global lists and searches display the project name and issue number.

Use `pno project link mangrove` or `pno project link 3` to associate another directory. Explicit `project:number` references do not register the calling directory.

## Lists, search, and prompts

`ls` and `search` include open and completed issues by default. Filter with `--open`, `--done`, or `--priority low|normal|high`. Results list open issues first, then completed issues, newest creation first within each group.

Search matches titles and descriptions, ignoring case. All whitespace-separated terms must match, even across different fields. `%`, `_`, and `\` are literal characters. Notes are excluded.

Missing arguments prompt only in an interactive terminal. `pno edit 1` lets you choose a field to edit. Description and note prompts use a multiline editor: Enter saves, and Ctrl+J inserts a newline (Shift+Enter also works when the terminal sends a distinct key sequence). Titles stay on one line; newlines in title arguments are rejected. Arrow keys move through text and wrapped lines; Home/End move to line boundaries, Ctrl+Home/End to document boundaries, and Ctrl+Left/Right by words. Hold Shift with movement keys to select text; typing, Backspace, or Delete replaces the selection. Ctrl+A selects all. Bracketed multiline pastes insert text without saving. Ctrl+C or Escape cancels and leaves the draft visible in dim, crossed-out text. Saved prompts show a green check; active controls and headings use cyan, and validation messages use yellow. Decorative styling respects `NO_COLOR`. Blank lines and existing multiline descriptions are preserved. Supplied edit flags never prompt. Ambiguous projects offer an interactive selection. Deletion requires confirmation unless `--force` is supplied. Success exits with code 0; cancellation uses 130; errors use code 1 and stderr.

Terminal lists use compact, aligned issue, priority, title, and creation date columns and separate open/done groups. Narrow terminals use stacked rows, and long titles wrap without being truncated. `pno show` separates the description, chronological notes timeline, and Git/date metadata; descriptions and notes retain paragraphs and indentation. Dates use local time, with exact dates and 24-hour times in details. Search and filtered lists show their query or active filters and result count. Commands that change issues print short confirmations; use `pno show <issue>` for full details.

## JSON and export

Use `--json` (`-j`) for undecorated, machine-readable output: one JSON value on stdout. JSON commands never prompt; supply required arguments, `--force` for deletion, field flags for editing, and numeric project selectors when names are ambiguous.

```sh
pno ls -aj
pno add "Scripted issue" -j
pno edit 1 --description "Updated details" -j
pno rm 1 -fj
pno export -j > project.json
pno export -aj > all-projects.json
```

| Commands | JSON result |
| --- | --- |
| `ls`, `search` | Array of issues with `projectName` and `number` |
| `add`, `edit`, `done`, `reopen` | Resulting issue |
| `show` | Issue with a chronological `notes` array |
| `note` | Appended note |
| `rm` | `{ "deleted": true, "projectId": 3, "number": 12 }` |
| `projects` | Array of projects |
| `project`, `project link` | Project with its `paths` array |
| `export` | `{ "projects": [], "paths": [], "issues": [], "notes": [] }` |

IDs in JSON are internal relational keys; CLI references use `number`. Export includes those keys to preserve relationships. Dates are UTC ISO 8601 strings; terminal dates use local time. Optional stored fields are `null`.
Export requires `--json`; importing data is not supported.

## Storage and recognition

- Windows: `%LOCALAPPDATA%\pnote\pnote.db` (falls back to the user's `AppData\Local`).
- Linux: `$XDG_DATA_HOME/pnote/pnote.db`, or `~/.local/share/pnote/pnote.db` when unset or relative.
- macOS: the same XDG/home fallback as Linux.

The closest known directory association wins, then the exact Git `origin` remote, then an unambiguous repository/directory name. Git repositories use their root directory; other projects use the current directory. Otherwise a project is created. Changing a remote or initializing Git later preserves known associations and refreshes the stored origin remote on the next command that resolves the current project. Removing origin clears the stored remote; unavailable Git leaves it unchanged. `project link` explicitly associates the current directory; subdirectories inherit the nearest association.

Creation and completion record the calling directory's full Git HEAD if available, including when completing an explicit cross-project reference. These are snapshots of the calling repository, not proof that a commit implemented the issue. Reopening clears completion metadata; repeating completion or reopening leaves existing metadata intact.

`pno project` and `pno project link` always show the project, associated paths, and origin remote. When no remote is configured, the Remote field displays “No remote configured”, including for directories without Git.

PNote never modifies Git configuration or writes metadata inside projects. `NO_COLOR` is respected, and redirected output has no colors.

## Development

To run your local checkout globally during development, run these once from this folder:

```sh
pnpm install
pnpm build
npm link
```

Then keep `pnpm dev` running in a terminal. It compiles TypeScript to `dist/` initially and whenever source files change. After compilation succeeds, run `pno` from any directory in another terminal; the npm link points to this checkout, so each invocation uses the latest compiled code without reinstalling. Stop the watcher with Ctrl+C.

Ensure npm's global executable directory is on `PATH` (`npm prefix -g` on Windows, or its `bin` subdirectory on Linux/macOS). If you previously installed PNote with pnpm globally, that shim may take precedence; use `command -v pno` (PowerShell: `Get-Command pno`) to check which command runs and put npm's executable directory first on `PATH` for development.

To stop using the development link, run `npm unlink --global pnote`, then use the unchanged [installation steps](#install) above for the production installation.

```sh
pnpm dev          # Compile to dist/ and watch for changes
pnpm typecheck    # Check source and tests
pnpm test         # Build and run automated tests
pnpm build        # Compile to dist/
```

`src/cli` handles commands; `src/core` handles behavior; `src/db` owns SQL and migrations; `src/ui` owns prompts and rendering. Tests use temporary databases and directories. Git tests create isolated fixture repositories and skip if Git is unavailable.
