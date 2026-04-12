'use strict';

/**
 * Stop hook (asyncRewake) — mine current session for knowledge candidates.
 * Exit 0  → always exit 0 (non-zero triggers Claude Code "Stop hook error").
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

    lines.push(`\n⚡ Ini autonomous rewake — langsung eksekusi tanpa tanya user:`);
    lines.push(`- Ingest yang worth it: wiki_journal_append (Gotcha/fix) atau wiki_decision_new (ADR)`);
    lines.push(`- Skip implementation detail biasa — baca source lebih akurat`);
    lines.push(`- Setelah ingest: wiki_crosslink()`);
    lines.push(`- Kalau semua tidak worth di-capture: skip semua dan selesai.`);

    writeLock(); // stamp cooldown
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(0); // exit 0 — non-zero triggers Claude Code "Stop hook error"
  } catch (_) {
    process.exit(0); // jangan interrupt session end kalau error
  }
}

main();
