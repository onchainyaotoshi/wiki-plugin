'use strict';

/**
 * SessionStart hook — mine recent sessions, inject candidates as additionalContext.
 * Outputs JSON to stdout for Claude Code.
 */

const path = require('path');
const { mineSessions } = require(path.join(__dirname, '../mcp/src/mine-helpers'));

async function main() {
  try {
    const result = await mineSessions({ since: '1d', limit: 4 });

    const totalHits = result.totalHits;
    if (totalHits === 0) {
      process.exit(0);
    }

    // Build summary for context injection
    const lines = [`📚 Wiki candidates dari sesi kemarin (${totalHits} total):`];
    for (const { cat, emoji, label, hits } of result.results) {
      if (hits.length === 0) continue;
      lines.push(`\n${emoji} ${label} — ${hits.length} hits`);
      for (const { date, session, snippet } of hits.slice(0, 2)) {
        lines.push(`  [${date}/${session}] ${snippet.slice(0, 200)}`);
      }
    }
    lines.push(`\nKalau ada yang worth di-capture: wiki_journal_append() atau wiki_decision_new()`);

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
