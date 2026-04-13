'use strict';

/**
 * SessionStart hook — mine recent sessions, inject candidates as additionalContext.
 * Also: extract current git branch and search wiki for related pages.
 * Outputs JSON to stdout for Claude Code.
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { mineSessions } = require(path.join(__dirname, '../mcp/src/mine-helpers'));

function loadConfig() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const opts = settings?.pluginConfigs?.['wiki@wiki-plugin']?.options || {};
    return {
      token:    opts.siyuan_token    || '',
      url:      opts.siyuan_url      || 'http://127.0.0.1:6806',
      notebook: opts.default_notebook || '',
    };
  } catch (_) {
    return { token: '', url: 'http://127.0.0.1:6806', notebook: '' };
  }
}

async function main() {
  try {
    const result = await mineSessions({ since: '1d', limit: 4 });

    const totalHits = result.totalHits;
    const lines = [];

    if (totalHits > 0) {
      lines.push(`📚 Wiki candidates dari sesi kemarin (${totalHits} total):`);
      for (const { cat, emoji, label, hits } of result.results) {
        if (hits.length === 0) continue;
        lines.push(`\n${emoji} ${label} — ${hits.length} hits`);
        for (const { date, session, snippet } of hits.slice(0, 2)) {
          lines.push(`  [${date}/${session}] ${snippet.slice(0, 200)}`);
        }
      }
      lines.push(`\nKalau ada yang worth di-capture: wiki_journal_append() atau wiki_decision_new()`);
    }

    // ── Branch-aware wiki context ───────────────────────────────────────────
    const cfg = loadConfig();
    if (cfg.token) {
      try {
        const { execSync } = require('child_process');
        process.env.SIYUAN_TOKEN = cfg.token;
        process.env.SIYUAN_URL   = cfg.url;
        if (cfg.notebook) process.env.WIKI_DEFAULT_NOTEBOOK = cfg.notebook;

        const srcDir = path.join(__dirname, '../mcp/src');
        const { makeClient, resolveNotebook } = require(path.join(srcDir, 'helpers'));

        const cwd    = process.env.PWD || process.cwd();
        const branch = execSync(`git -C "${cwd}" branch --show-current 2>/dev/null`, { encoding: 'utf8' }).trim();

        if (branch && !['main', 'master', 'HEAD', ''].includes(branch)) {
          const client = makeClient();
          const nbName = resolveNotebook(cfg.notebook);
          const nb     = await client.getNotebookByName(nbName);

          if (nb) {
            const branchResults = await client.fullTextSearch(branch, { notebookId: nb.id, limit: 2 });
            if (branchResults && branchResults.length > 0) {
              lines.push(`\n🌿 Branch: **${branch}** — related wiki pages:`);
              for (const r of branchResults.slice(0, 2)) {
                const hpath   = r.hpath || r.path || '?';
                const content = (r.content || '').replace(/\s+/g, ' ').slice(0, 120);
                lines.push(`  • ${hpath}: ${content}`);
              }
            } else {
              lines.push(`\n🌿 Branch: **${branch}** (no wiki pages found for this branch)`);
            }
          }
        }
      } catch (_) {
        // Branch-aware surfacing is best-effort — don't block session start
      }
    }

    if (lines.length === 0) {
      process.exit(0);
    }

    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: lines.join('\n'),
      },
    };

    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
  } catch (_) {
    // Jangan block session start kalau mining gagal
    process.exit(0);
  }
}

main();
