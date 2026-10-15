import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IssueSummary, Note, Project } from '../src/core/model.js';
import { clean, displayWidth, wrap } from '../src/ui/layout.js';
import { issueDetail, issueList, projectDetail } from '../src/ui/render.js';

const project: Project = { id: 1, name: 'pnote', remote: null, createdAt: '2026-10-13T07:14:00Z' };
const issue: IssueSummary = {
  id: 42, projectId: 1, projectName: 'pnote', number: 42,
  title: 'Fix recovery after restart', priority: 'high', status: 'open',
  description: 'First paragraph.\n\nSteps:\n  1. Write a record.\n  2. Restart.',
  createdAt: '2026-10-13T07:14:00Z', updatedAt: '2026-10-13T08:06:00Z',
  completedAt: null, createdCommit: 'a1b2c3d40000000000000000000000000000000000', completedCommit: null,
};
const notes: Note[] = [
  { id: 1, issueId: 42, createdAt: '2026-10-13T07:24:00Z', content: 'Reproduced on Windows.' },
  { id: 2, issueId: 42, createdAt: '2026-10-13T08:06:00Z', content: 'Fails after the first write.\nNext: inspect recovery.' },
];

test('compact lists align titles and creation dates across status groups', () => {
  const output = issueList([issue, { ...issue, id: 38, number: 38, title: 'Document linking', priority: 'low' },
    { ...issue, id: 35, number: 35, title: 'Handle empty repositories', priority: 'normal', status: 'done' }], false, project);
  assert.match(output, /3 issues · 2 open · 1 done/);
  assert.ok(output.indexOf('OPEN · 2') < output.indexOf('DONE · 1'));
  const rows = output.split('\n').filter(line => /^  #/.test(line));
  assert.equal(rows[0]!.indexOf(issue.title), rows[1]!.indexOf('Document linking'));
  assert.equal(rows[0]!.indexOf(issue.title), rows[2]!.indexOf('Handle empty repositories'));
  assert.match(output, /CREATED/);
  assert.match(output, /ISSUE\s+PRIORITY\s+TITLE\s+CREATED/);
  assert.doesNotMatch(output, /\x1b/);
});

test('detail preserves paragraphs and indentation with chronological timeline notes', () => {
  const output = issueDetail(issue, notes);
  assert.match(output, /pnote:42 \/ open \/ high\nFix recovery after restart/);
  assert.match(output, /Description\n  First paragraph\.\n  \n  Steps:\n    1\. Write a record\./);
  assert.match(output, /Notes · 2\n  │\n  ●/);
  assert.match(output, /  │ Fails after the first write\.\n  │ Next: inspect recovery\./);
  assert.ok(output.indexOf(notes[0]!.content) < output.indexOf('Fails after'));
  assert.match(output, /Git at creation\s+a1b2c3d4/);
  assert.doesNotMatch(output, /priority|\x1b/i);
  const completed = issueDetail({ ...issue, status: 'done', completedAt: issue.updatedAt,
    completedCommit: 'deadbeef00000000000000000000000000000000' });
  assert.match(completed, /Completed\s+/);
  assert.match(completed, /Git at completion\s+deadbeef/);
});

test('search, filters and empty results retain scope and context', () => {
  const output = issueList([issue], true, undefined, { search: 'recovery', status: 'open', priority: 'high' });
  assert.match(output, /Search "recovery"/);
  assert.match(output, /All projects · open · high · 1 match/);
  assert.match(output, /pnote:42/);
  assert.match(issueList([], false, project), /No issues yet\./);
  const emptySearch = issueList([], false, project, { search: 'missing', priority: 'high' });
  assert.match(emptySearch, /pnote · high · 0 matches/);
  assert.match(emptySearch, /No matching issues\./);
  assert.doesNotMatch(emptySearch, /Create one/);
});

test('wrapping keeps all text and fits narrow, normal, and wide terminals', () => {
  const title = 'Investigate 数据恢复 👩🏽‍💻 e\u0301 across worktrees ' + 'z'.repeat(140);
  const longIssue = { ...issue, title, projectName: 'an-extremely-long-project-name', number: 1042 };
  for (const width of [40, 80, 120]) {
    for (const output of [issueList([longIssue], true, undefined, {}, width), issueDetail(longIssue, notes, width)]) {
      for (const line of output.split('\n')) assert.ok(displayWidth(line) <= width, `${width}: ${line}`);
      assert.match(output, /👩🏽‍💻/);
      assert.match(output, /e\u0301/);
      assert.equal((output.match(/z/g) ?? []).length, 140);
    }
  }
  const text = '数据恢复 👩🏽‍💻 e\u0301 ' + 'x'.repeat(100);
  assert.equal(wrap(text, 12).join('').replace(/ /g, ''), text.replace(/ /g, ''));
});

test('terminal commands are stripped while safe multiline content remains', () => {
  const unsafe = '\x1b[31mRed\x1b[0m\n\tIndented\x1b]0;change-title\x07\x00';
  assert.equal(clean(unsafe, true), 'Red\n  Indented ');
  const output = issueDetail({ ...issue, title: unsafe, description: unsafe }, [{ ...notes[0]!, content: unsafe }]);
  assert.doesNotMatch(output, /\x1b|\x00|\x07|change-title|\[31m/);
  assert.match(output, /Red\n    Indented/);
});


test('project detail always shows paths and remote without a separate Git field', () => {
  const paths = [{ projectId: project.id, path: '/work/pnote' }];
  const plain = projectDetail(project, paths);
  assert.match(plain, /pnote · project 1/);
  assert.match(plain, /Paths\s+\/work\/pnote/);
  assert.match(plain, /Remote\s+No remote configured/);
  assert.doesNotMatch(plain, /^Git\s/m);
  const remote = 'https://example.invalid/pnote.git';
  const attached = projectDetail({ ...project, remote }, paths);
  assert.match(attached, /Remote\s+https:\/\/example.invalid\/pnote.git/);
  assert.doesNotMatch(attached, /^Git\s/m);
  assert.match(projectDetail(project, []), /Paths\s+No associated paths/);
});
