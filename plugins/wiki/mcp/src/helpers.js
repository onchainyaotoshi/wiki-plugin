'use strict';

const SiYuanClient = require('./siyuan-client');
const config       = require('./config');

/**
 * Derive notebook name from current project path (process.env.PWD).
 * /home/firman/camis_api_native → camis-api-native-wiki
 * /home/firman/other-project   → other-project-wiki
 */
function notebookFromPwd() {
  const pwd = process.env.PWD;
  if (!pwd) return 'wiki';
  const name = pwd.split('/').pop()            // last segment
    .replace(/[_\s]/g, '-')                    // underscore/space → hyphen
    .replace(/[^a-zA-Z0-9-]/g, '')             // strip other special chars
    .replace(/-+/g, '-')                       // collapse multiple hyphens
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
