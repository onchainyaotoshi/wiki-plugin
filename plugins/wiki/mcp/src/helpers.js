'use strict';

const path         = require('path');
const SiYuanClient = require('./siyuan-client');
const config       = require('./config');

/**
 * Derive notebook name from current project path (process.env.PWD).
 * Automatically resolves git worktrees to their main project directory,
 * regardless of worktree path structure:
 *   /home/firman/camis_api_native/.claude/worktrees/feat+foo → camis-api-native-wiki
 *   /home/firman/camis_api_native-feat-branch               → camis-api-native-wiki
 *   /home/firman/camis_api_native                           → camis-api-native-wiki
 */
function notebookFromPwd() {
  const pwd = process.env.PWD;
  if (!pwd) return 'wiki';

  // Try to find the main worktree root via git.
  // `git rev-parse --git-common-dir` returns:
  //   - '.git' (relative) when we're in the main worktree
  //   - '/abs/path/to/main/.git' when we're in a linked worktree
  // path.resolve(pwd, result) normalises both cases to an absolute path,
  // then dirname gives us the main project directory.
  try {
    const { execSync } = require('child_process');
    const rawCommonDir = execSync('git rev-parse --git-common-dir', {
      cwd: pwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    const projectDir = path.dirname(path.resolve(pwd, rawCommonDir));
    const name = path.basename(projectDir)
      .replace(/[_\s]/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .toLowerCase();
    return `${name}-wiki`;
  } catch {
    // Not a git repo or git unavailable — fall back to last PWD segment.
  }

  const name = pwd.split('/').pop()
    .replace(/[_\s]/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .toLowerCase();
  return `${name}-wiki`;
}

/**
 * Resolve the notebook name to use for a tool call.
 * Priority: explicit arg → WIKI_DEFAULT_NOTEBOOK env → auto-derive from PWD
 */
function resolveNotebook(notebookArg) {
  return notebookArg || config.defaultNotebook || notebookFromPwd();
}

/** Factory — creates a SiYuanClient with config defaults. */
function makeClient() {
  return new SiYuanClient(config.baseUrl, config.token);
}

/** YYYY-MM-DD in local time */
function today() {
  const d   = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = { resolveNotebook, makeClient, today };
