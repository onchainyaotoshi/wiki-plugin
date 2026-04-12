'use strict';

const token = process.env.SIYUAN_TOKEN;
if (!token) {
  throw new Error(
    'SIYUAN_TOKEN environment variable is required. ' +
    'Set it in ~/.claude/settings.json under mcpServers.wiki-mcp.env'
  );
}

module.exports = {
  baseUrl: process.env.SIYUAN_URL || 'http://127.0.0.1:6806',
  token,
  defaultNotebook: process.env.WIKI_DEFAULT_NOTEBOOK || 'camis-wiki',
};
