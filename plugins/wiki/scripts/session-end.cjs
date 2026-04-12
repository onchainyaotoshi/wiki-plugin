'use strict';

/**
 * Stop hook (asyncRewake) — mine current session for knowledge candidates.
 * Exit 0  → nothing found, no rewake.
 * Exit 2  → candidates found, agent rewakes with output.
 *
 * Guard: lock file prevents rewaking more than once per COOLDOWN_MS.
 * Prevents infinite rewake loop when agent asks user and user responds
 * without ingesting candidates.
 */

const fs = require('fs');
const path = require('path');
const { mineSessions } = require(path.join(__dirname, '../mcp/src/mine-helpers'));

const LOCK_FILE = '/tmp/wiki-stop-rewake.lock';
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

function isInCooldown() {
  try {
    if (!fs.existsSync(LOCK_FILE)) return false;
    const stat = fs.statSync(LOCK_FILE);
    return (Date.now() - stat.mtimeMs) < COOLDOWN_MS;
  } catch (_) {
    return false;
  }
}

function writeLock() {
  try { fs.writeFileSync(LOCK_FILE, String(Date.now())); } catch (_) {}
}

async function main() {
  try {
    // Skip rewake if already rewoke recently (prevents infinite loop)
    if (isInCooldown()) {
      process.exit(0);
    }

    const result = await mineSessions({ since: '3h', limit: 6 });

    if (result.totalHits === 0) {
      process.exit(0);
    }

    // Build candidates summary for rewake context
    const lines = [];
    for (const { emoji, label, hits } of result.results) {
      if (hits.length === 0) continue;
      lines.push(`${emoji} ${label}:`);
      for (const { date, snippet } of hits) {
        lines.push(`  • ${snippet.slice(0, 300)}`);
      }
    }

    lines.push(`\nAction yang perlu dilakukan:`);
    lines.push(`- Untuk setiap gotcha/fix: wiki_journal_append(text, section="Gotcha")`);
    lines.push(`- Untuk keputusan arsitektur: wiki_decision_new(slug, title)`);
    lines.push(`- Setelah ingest: wiki_crosslink()`);
    lines.push(`- Kalau tidak ada yang worth di-capture, skip.`);

    writeLock(); // stamp cooldown before rewaking
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(2); // rewake agent
  } catch (_) {
    process.exit(0); // jangan interrupt session end kalau error
  }
}

main();
