export type Priority = 'low' | 'normal' | 'high';
export type Status = 'open' | 'done';

export interface Project {
  id: number;
  name: string;
  remote: string | null;
  createdAt: string;
}

export interface ProjectPath {
  path: string;
  projectId: number;
}

export interface Issue {
  id: number;
  projectId: number;
  number: number;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  createdCommit: string | null;
  completedCommit: string | null;
  createdAgent: string | null;
  createdSession: string | null;
  completedAgent: string | null;
  completedSession: string | null;
}

export interface IssueSummary extends Issue {
  projectName: string;
  // Computed for terminal listings only; never persisted.
  hasAgentActivity?: boolean;
}

export interface Note {
  id: number;
  issueId: number;
  content: string;
  createdAt: string;
  agent: string | null;
  session: string | null;
}

export interface Attribution {
  agent?: string;
  session?: string;
}

export interface IssueFilter {
  projectId?: number;
  status?: Status;
  priority?: Priority;
  search?: string;
}

export interface IssueInput {
  title: string;
  description?: string | null;
  priority?: Priority;
}

export interface ExportData {
  projects: Project[];
  paths: ProjectPath[];
  issues: Issue[];
  notes: Note[];
}
