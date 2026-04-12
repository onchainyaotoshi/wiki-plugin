'use strict';

/**
 * Stop hook — auto-ingest knowledge candidates directly to SiYuan.
 * No asyncRewake, no Claude wakeup, no token burn.
 *
 * Flow: mine last 3h → dedup against seen-hashes → POST to SiYuan → crosslink.
 * Token dari ~/.claude/settings.json (pluginConfigs.wiki@wiki-plugin.options).
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const LOG_FILE  = '/tmp/wiki-auto-ingest.log';
const SEEN_FILE = path.join(os.homedir(), '.claude', 'wiki-auto-ingest-seen.json');
const MAX_SEEN  = 500;

const SECTION_MAP = {
  gotcha:   'Gotcha',
  decision: 'Architecture Decision',
  fix:      'Root Cause / Fix',
  pattern:  'Convention / Pattern',
};

// ── Config ───────────────────────────────────────────────────────────────────

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

// ── Dedup ────────────────────────────────────────────────────────────────────

function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'))); }
  catch (_) { return new Set(); }
}

function saveSeen(seen) {
  try {
    const arr = [...seen].slice(-MAX_SEEN);
    fs.writeFileSync(SEEN_FILE, JSON.stringify(arr));
  } catch (_) {}
}

function fingerprint(snippet) {
  return snippet.slice(0, 80).toLowerCase().replace(/\s+/g, ' ');
}

// ── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  try {
    const line = `${new Date().toISOString()} [${process.env.PWD || '?'}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadConfig();
  if (!cfg.token) {
    log('skip — no SIYUAN_TOKEN in settings.json');
    process.exit(0);
  }

  // Inject env vars BEFORE requiring any helper that reads process.env at load time
  process.env.SIYUAN_TOKEN          = cfg.token;
  process.env.SIYUAN_URL            = cfg.url;
  if (cfg.notebook) process.env.WIKI_DEFAULT_NOTEBOOK = cfg.notebook;

  try {
    const srcDir         = path.join(__dirname, '../mcp/src');
    const { mineSessions }  = require(path.join(srcDir, 'mine-helpers'));
    const { journalAppend } = require(path.join(srcDir, 'journal-helpers'));
    const { crosslink }     = require(path.join(srcDir, 'crosslink-helpers'));
    const { makeClient, resolveNotebook, today } = require(path.join(srcDir, 'helpers'));

    const mined = await mineSessions({ since: '3h', limit: 6 });
    if (mined.totalHits === 0) {
      log(`no candidates (${mined.blocksScanned} blocks scanned)`);
      process.exit(0);
    }

    const seen   = loadSeen();
    const client = makeClient();
    const nbName = resolveNotebook(cfg.notebook);
    const date   = today();
    let count    = 0;

    for (const { cat, hits } of mined.results) {
      const section = SECTION_MAP[cat] || cat;
      for (const hit of hits) {
        const fp = fingerprint(hit.snippet);
        if (seen.has(fp)) continue;
        seen.add(fp);
        await journalAppend(client, nbName, section, hit.snippet, date);
        count++;
      }
    }

    saveSeen(seen);

    if (count > 0) {
      const nb = await client.getOrCreateNotebook(nbName);
      await crosslink(client, nb.id);
    }

    log(`ingested ${count} new / ${mined.totalHits} candidates found`);
    process.exit(0);
  } catch (err) {
    log(`ERROR: ${err.message}`);
    process.exit(0);
  }
}

main();
