'use strict';

/**
 * UserPromptSubmit hook — proactive wiki surfacing.
 * Searches wiki for relevant pages before Claude processes the user's prompt,
 * then injects them as additionalContext.
 *
 * Input (stdin):  {"prompt": "...", "cwd": "..."}
 * Output (stdout): {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "..."}}
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');

// Keywords that map to specific sub-index paths for targeted lookup
const CATEGORY_KEYWORDS = {
  gotcha:      '/index-gotchas',
  decision:    '/index-decisions',
  guide:       '/index-guides',
  integration: '/index-integrations',
  journal:     '/index-journal',
};

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

  let prompt = '';
  try { prompt = JSON.parse(input)?.prompt || ''; } catch (_) { process.exit(0); }
  if (!prompt || prompt.length < 10) { process.exit(0); }

  process.env.SIYUAN_TOKEN = cfg.token;
  process.env.SIYUAN_URL   = cfg.url;
  if (cfg.notebook) process.env.WIKI_DEFAULT_NOTEBOOK = cfg.notebook;

  try {
    const srcDir = path.join(__dirname, '../mcp/src');
    const { makeClient, resolveNotebook } = require(path.join(srcDir, 'helpers'));
    const client = makeClient();
    const nbName = resolveNotebook(cfg.notebook);
    const nb     = await client.getNotebookByName(nbName);
    if (!nb) { process.exit(0); }

    const promptLower = prompt.toLowerCase();

    // Check if prompt contains category keywords — do targeted sub-index lookup
    let categoryPage = null;
    for (const [keyword, subIndexPath] of Object.entries(CATEGORY_KEYWORDS)) {
      if (promptLower.includes(keyword)) {
        categoryPage = subIndexPath;
        break;
      }
    }

    const lines = ['📖 Relevant wiki context:'];

    if (categoryPage) {
      // Targeted: fetch the sub-index page
      const doc = await client.getDocByHPath(nb.id, categoryPage);
      if (doc) {
        const { kramdown } = await client.getBlockKramdown(doc.id).catch(() => ({ kramdown: '' }));
        if (kramdown) {
          const preview = kramdown.replace(/\s+/g, ' ').slice(0, 400);
          lines.push(`• **${categoryPage}** (category index): ${preview}`);
        }
      }
    }

    // Always do full-text search with first 100 chars of prompt
    const query   = prompt.slice(0, 100);
    const results = await client.fullTextSearch(query, { notebookId: nb.id, limit: 3 });

    if (results && results.length > 0) {
      for (const r of results) {
        const hpath   = r.hpath || r.path || '?';
        // Skip sub-index pages in search results (they're meta, not knowledge)
        if (hpath.startsWith('/index')) continue;
        const content = (r.content || '').replace(/\s+/g, ' ').slice(0, 150);
        lines.push(`• **${hpath}**: ${content}`);
      }
    }

    // Only output if we found something beyond the header
    if (lines.length <= 1) { process.exit(0); }

    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: lines.join('\n'),
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
}

main();
