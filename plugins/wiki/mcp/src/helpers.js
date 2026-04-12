'use strict';

const SiYuanClient = require('./siyuan-client');
const config       = require('./config');

/**
 * Resolve the notebook name to use for a tool call.
 * Priority: explicit arg → WIKI_DEFAULT_NOTEBOOK env → 'camis-wiki'
 */
function resolveNotebook(notebookArg) {
  return notebookArg || config.defaultNotebook;
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
