'use strict';

/**
 * Wiki lint helpers — gaps (#4) and graph (#3).
 * Ported from docs/wiki/lint-gaps.js + lint-graph.js (no project coupling).
 */

// ── Lint Gaps ──────────────────────────────────────────────────────────────

const PATTERNS = [
  /`([A-Za-z_][A-Za-z0-9_]{3,40})`/g,
  /\b([A-Z][a-z]+[A-Z][A-Za-z]{2,})\b/g,
  /\b([A-Z]{2,}[_][A-Z][A-Z_]{2,})\b/g,
  /\b([a-z]+-[a-z]+[a-z-]*)\b/g,
];

const STOP_TERMS = new Set([
  'TODO','FIXME','NOTE','WARNING','README','LICENSE','CHANGELOG',
  'TypeScript','JavaScript','NodeJS','function','return','const','let','var',
  'async','await','promise','GET','POST','PUT','DELETE','PATCH',
  'JSON','HTML','CSS','SQL','API','URL','URI','HTTP','HTTPS','TCP','UDP',
  'read-only','read-write','up-to-date',
]);

async function lintGaps(client, notebookId) {
  const docs = await client.sql(
    `SELECT id, hpath FROM blocks WHERE type='d' AND box='${notebookId}' LIMIT 10000`
  );

  const definedConcepts = new Set();
  for (const doc of docs) {
    const slug = doc.hpath.split('/').pop();
    definedConcepts.add(slug.toLowerCase());
    definedConcepts.add(slug.replace(/[-_]/g, ' ').toLowerCase());
    definedConcepts.add(slug.replace(/[-_]/g, '_').toUpperCase().toLowerCase());
    const escapedId = doc.id.replace(/'/g, "''");
    const h1 = await client.sql(
      `SELECT markdown FROM blocks WHERE root_id='${escapedId}' AND type='h' AND subtype='h1' LIMIT 1`
    );
    if (h1[0]) {
      const title = h1[0].markdown.replace(/^#+\s*/, '').trim();
      const words = title.match(/[A-Z][a-z]+[A-Za-z]*|[A-Z_]{3,}/g) || [];
      for (const w of words) definedConcepts.add(w.toLowerCase());
    }
  }

  const blocks = await client.sql(
    `SELECT id, type, root_id, markdown FROM blocks
     WHERE box='${notebookId}' AND type IN ('p','h','i','t')
     AND markdown IS NOT NULL AND markdown != ''
     LIMIT 100000`
  );

  const mentions = new Map();
  for (const block of blocks) {
    const stripped = block.markdown
      .replace(/\(\([^)]+\)\)/g, '')
      .replace(/\[[^\]]+\]\([^)]+\)/g, '')
      .replace(/\{:[^}]+\}/g, '');

    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(stripped))) {
        const term = m[1];
        if (STOP_TERMS.has(term)) continue;
        if (term.length < 4) continue;
        if (definedConcepts.has(term.toLowerCase())) continue;

        const key = term.toLowerCase();
        if (!mentions.has(key)) {
          mentions.set(key, { term, count: 0, pages: new Set(), samples: [] });
        }
        const entry = mentions.get(key);
        entry.count++;
        entry.pages.add(block.root_id);
        if (entry.samples.length < 3) {
          const start   = Math.max(0, m.index - 30);
          const end     = Math.min(stripped.length, m.index + m[0].length + 30);
          const excerpt = stripped.slice(start, end).replace(/\s+/g, ' ').trim();
          entry.samples.push(excerpt);
        }
      }
    }
  }

  const gaps = Array.from(mentions.values())
    .filter(e => e.count >= 3 || e.pages.size >= 2)
    .sort((a, b) => b.count !== a.count ? b.count - a.count : b.pages.size - a.pages.size)
    .slice(0, 30)
    .map(g => ({ term: g.term, count: g.count, pages: g.pages.size, samples: g.samples }));

  return { totalDocs: docs.length, totalBlocks: blocks.length, gaps };
}

// ── Lint Graph ─────────────────────────────────────────────────────────────

async function lintGraph(client, notebookId) {
  const docs = await client.sql(
    `SELECT id, hpath FROM blocks WHERE type='d' AND box='${notebookId}' AND ial LIKE '%custom-wiki-type%' LIMIT 10000`
  );

  const docMap = {};
  for (const d of docs) docMap[d.id] = d.hpath;

  const refs = await client.sql(
    `SELECT root_id, def_block_root_id FROM refs WHERE box='${notebookId}' LIMIT 100000`
  );

  const outgoing = {};
  const incoming = {};
  for (const d of docs) { outgoing[d.id] = new Set(); incoming[d.id] = new Set(); }

  for (const r of refs) {
    if (r.root_id === r.def_block_root_id) continue;
    if (!docMap[r.root_id] || !docMap[r.def_block_root_id]) continue;
    outgoing[r.root_id].add(r.def_block_root_id);
    incoming[r.def_block_root_id].add(r.root_id);
  }

  const stats    = docs.map(d => ({ hpath: d.hpath, id: d.id, out: outgoing[d.id].size, in: incoming[d.id].size }));
  const orphans  = stats.filter(s => s.in === 0 && s.out > 0).map(s => s.hpath);
  const isolated = stats.filter(s => s.in === 0 && s.out === 0).map(s => s.hpath);
  const hubs     = stats.filter(s => s.in > 0).sort((a, b) => b.in - a.in).slice(0, 5)
    .map(h => ({ hpath: h.hpath, incoming: h.in }));
  const connectors = stats.filter(s => s.out > 0).sort((a, b) => b.out - a.out).slice(0, 5)
    .map(c => ({ hpath: c.hpath, outgoing: c.out }));

  const visited    = new Set();
  const components = [];
  for (const d of docs) {
    if (visited.has(d.id)) continue;
    const component = new Set();
    const queue     = [d.id];
    while (queue.length) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      component.add(cur);
      for (const n of outgoing[cur] || []) queue.push(n);
      for (const n of incoming[cur] || []) queue.push(n);
    }
    components.push(component);
  }
  components.sort((a, b) => b.size - a.size);
  const mainland = components[0]?.size || 0;
  const islands  = components.slice(1).map(c => Array.from(c).map(id => docMap[id]));

  return {
    totalDocs: docs.length, totalRefs: refs.length,
    density: refs.length / (docs.length || 1),
    orphans, isolated, hubs, connectors,
    mainland, islandCount: islands.length, islands,
  };
}

// ── Lint Contradictions ────────────────────────────────────────────────────

async function lintContradictions(client, notebookId) {
  // 1. Get all non-journal, non-log, non-index docs
  const docs = await client.sql(
    `SELECT hpath, id FROM blocks WHERE type='d' AND box='${notebookId}' LIMIT 100`
  );

  const pageClaims = [];
  for (const doc of docs) {
    if (!doc.hpath) continue;
    if (doc.hpath.includes('/Journal/') || doc.hpath.endsWith('/log') || doc.hpath.endsWith('/index')) continue;
    const { kramdown } = await client.getBlockKramdown(doc.id).catch(() => ({ kramdown: '' }));
    if (!kramdown) continue;
    // Extract bullet points and short sentences as "claims"
    const claims = kramdown
      .split('\n')
      .filter(l => l.trim().length > 30 && l.trim().length < 300)
      .map(l => l.replace(/^[-*>]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 20);
    if (claims.length) pageClaims.push({ hpath: doc.hpath, claims });
  }

  // 2. Look for simple negation patterns between pages
  // Flag pairs where one page says "always X" and another says "never X" or "don't X"
  const POSITIVE = [/\bselalu\b/i, /\bwajib\b/i, /\bgunakan\b/i, /\bpakai\b/i, /\balways\b/i, /\bmust\b/i, /\buse\b/i];
  const NEGATIVE = [/\bjangan\b/i, /\bdilarang\b/i, /\bjangan pernah\b/i, /\bnever\b/i, /\bdon't\b/i, /\bavoid\b/i, /\bdo not\b/i];

  const flags = [];

  for (let i = 0; i < pageClaims.length; i++) {
    for (let j = i + 1; j < pageClaims.length; j++) {
      const a = pageClaims[i];
      const b = pageClaims[j];

      for (const ca of a.claims) {
        for (const cb of b.claims) {
          // Extract subject (first 3-4 words after removing sentiment)
          const subjectA = ca.replace(/^(selalu|wajib|jangan|always|never|must|don't)\s+/i, '').slice(0, 40).toLowerCase();
          const subjectB = cb.replace(/^(selalu|wajib|jangan|always|never|must|don't)\s+/i, '').slice(0, 40).toLowerCase();

          // Check if subjects overlap (>3 chars in common)
          const wordsA = new Set(subjectA.split(/\s+/).filter(w => w.length > 3));
          const wordsB = subjectB.split(/\s+/).filter(w => w.length > 3);
          const overlap = wordsB.filter(w => wordsA.has(w));

          if (overlap.length < 1) continue;

          const aPositive = POSITIVE.some(p => p.test(ca));
          const aNegative = NEGATIVE.some(p => p.test(ca));
          const bPositive = POSITIVE.some(p => p.test(cb));
          const bNegative = NEGATIVE.some(p => p.test(cb));

          if ((aPositive && bNegative) || (aNegative && bPositive)) {
            flags.push({
              pageA: a.hpath, claimA: ca.slice(0, 100),
              pageB: b.hpath, claimB: cb.slice(0, 100),
              overlap,
            });
          }
        }
      }
      if (flags.length > 20) break; // cap at 20 findings
    }
    if (flags.length > 20) break;
  }

  return flags;
}

// ── Lint Stale ─────────────────────────────────────────────────────────────

async function lintStale(client, notebookId) {
  const { hashPaths } = require('./hash-helpers');

  const rows = await client.sql(
    `SELECT b.hpath, b.id, a.value as source_files,
            (SELECT value FROM attributes WHERE name='custom-source-hash' AND block_id=b.id LIMIT 1) as stored_hash
     FROM blocks b
     JOIN attributes a ON a.block_id = b.id
     WHERE b.box='${notebookId}' AND b.type='d' AND a.name='custom-source-files'`
  );

  const stale = [];

  for (const row of rows) {
    if (!row.source_files || !row.stored_hash) continue;
    const filePaths = row.source_files.split(',').map(s => s.trim()).filter(Boolean);
    try {
      const { hash } = hashPaths(filePaths, '');
      if (hash !== row.stored_hash) {
        stale.push({
          hpath: row.hpath,
          source_files: filePaths,
          stored_hash: row.stored_hash,
          current_hash: hash,
        });
      }
    } catch (_) {
      // Source file missing — also stale
      stale.push({
        hpath: row.hpath,
        source_files: filePaths,
        stored_hash: row.stored_hash,
        current_hash: null,
        error: 'source file not found',
      });
    }
  }

  return stale;
}

module.exports = { lintGaps, lintGraph, lintContradictions, lintStale };
