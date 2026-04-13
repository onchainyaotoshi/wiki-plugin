'use strict';

/**
 * PreToolUse hook — inject wiki context before file edits.
 * Reads the file path from stdin tool input and searches the wiki for relevant context.
 *
 * Input (stdin):  { "tool_name": "Edit", "tool_input": { "file_path": "..." } }
 * Output (stdout): { "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "..." } }
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');

function loadConfig() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
    const o = s?.pluginConfigs?.['wiki@wiki-plugin']?.options || {};
    return { token: o.siyuan_token || '', url: o.siyuan_url || 'http://127.0.0.1:6806', notebook: o.default_notebook || '' };
  } catch (_) { return { token: '', url: 'http://127.0.0.1:6806', notebook: '' }; }
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;

  const cfg = loadConfig();
  if (!cfg.token) { process.exit(0); }

  let filePath = '';
  try {
    const parsed = JSON.parse(input);
    filePath = parsed?.tool_input?.file_path || parsed?.tool_input?.path || '';
  } catch (_) { process.exit(0); }
  if (!filePath) { process.exit(0); }

  // Skip non-project files and plugin's own files
  if (filePath.startsWith('/tmp') || filePath.includes('.claude/plugins')) { process.exit(0); }

  process.env.SIYUAN_TOKEN = cfg.token;
  process.env.SIYUAN_URL   = cfg.url;
  if (cfg.notebook) process.env.WIKI_DEFAULT_NOTEBOOK = cfg.notebook;

  try {
    // Fast pre-flight — check if SiYuan is reachable
    await fetch(cfg.url + '/api/system/version', { signal: AbortSignal.timeout(2000) });
  } catch (_) { process.exit(0); }

  try {
    const srcDir = path.join(__dirname, '../mcp/src');
    const { makeClient, resolveNotebook }  = require(path.join(srcDir, 'helpers'));
    const { getContextForPaths }           = require(path.join(srcDir, 'path-context-helpers'));

    const client  = makeClient();
    const nbName  = resolveNotebook(cfg.notebook);
    const results = await getContextForPaths(client, nbName, [filePath]);

    if (!results || results.length === 0) { process.exit(0); }

    const lines = [`📖 Wiki context for ${path.basename(filePath)}:`];
    for (const r of results) lines.push(`• **${r.hpath}**: ${r.content}`);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName:     'PreToolUse',
        additionalContext: lines.join('\n'),
      },
    }) + '\n');
    process.exit(0);
  } catch (_) { process.exit(0); }
}

main();
