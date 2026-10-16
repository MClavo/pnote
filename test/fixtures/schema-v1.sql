-- Frozen pre-attribution schema for migration compatibility tests.
CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    remote TEXT,
    createdAt TEXT NOT NULL,
    nextIssueNumber INTEGER NOT NULL DEFAULT 1 CHECK(nextIssueNumber > 0)
  );
  CREATE TABLE project_paths (
    path TEXT PRIMARY KEY,
    projectId INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK(number > 0),
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done')),
    priority TEXT NOT NULL DEFAULT 'low' CHECK(priority IN ('low', 'normal', 'high')),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    completedAt TEXT,
    createdCommit TEXT,
    completedCommit TEXT,
    UNIQUE(projectId, number)
  );
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issueId INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    createdAt TEXT NOT NULL
  );
  CREATE INDEX notes_issue ON notes(issueId, createdAt, id);
  CREATE INDEX projects_name ON projects(name);
  CREATE INDEX projects_remote ON projects(remote);
  CREATE INDEX paths_project ON project_paths(projectId);
  CREATE INDEX issues_listing ON issues(projectId, status, createdAt);
PRAGMA user_version = 1;
