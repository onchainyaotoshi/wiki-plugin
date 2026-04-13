'use strict';

/**
 * Session mining — extract knowledge candidates from Claude Code sessions
 * and CE plan/brainstorm files.
 * Ported from docs/wiki/mine-sessions.js.
 * Uses process.env.PWD as default project path.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const MIN_TEXT_LEN    = 150;
const SNIPPET_CONTEXT = 200;

const CATEGORIES = {
  gotcha: {
    label: 'Gotcha / Pitfall', emoji: '⚠️',
    patterns: [
      /gotcha/i, /JANGAN(?:\s+PERNAH)?/, /jangan\b.{0,40}karena/i,
      /selalu false/i, /silent fail/i, /tidak bisa.{0,20}undo/i,
      /stale\b.{0,30}(kolom|data|cache)/i, /ternyata.{0,30}(salah|bug|problem)/i,
      /ini yang bikin bug/i,
    ],
  },
  decision: {
    label: 'Architecture Decision', emoji: '🏛️',
    patterns: [
      /kenapa\b.{0,50}bukan\b/i, /kita (pilih|putuskan|sepakat)/i,
      /trade.?off/i, /diputuskan:/i,
      /approach.{0,30}(terpilih|dipilih)/i, /kesimpulan.{0,20}:/i,
    ],
  },
  fix: {
    label: 'Root Cause / Fix', emoji: '🔧',
    patterns: [
      /root cause/i, /penyebab(nya)?\s*:/i,
      /ternyata.{0,50}(adalah|karena|bug)/i, /ketemu.{0,30}(bug|masalah|root)/i,
      /one.line fix/i, /fix(nya)?\s*:/i,
    ],
  },
  pattern: {
    label: 'Convention / Pattern', emoji: '📐',
    patterns: [
      /convention\b/i, /wajib pakai\b/i,
      /standar(kan)?\b.{0,30}ke\b/i, /flow(nya)? adalah/i,
      /pola yang (benar|dipakai)/i, /WAJIB:/,
    ],
  },
  workflow: {
    label: 'Workflow / Procedure', emoji: '🔄',
    patterns: [], // special — not regex-matched, extracted by extractToolSequences
  },
};

/**
 * Sanitize project path to Claude Code's sessions directory name.
 * /home/firman/camis_api_native → -home-firman-camis-api-native
 */
function sessionsDir(projectPath) {
  const sanitized = projectPath.replace(/[/_]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', sanitized);
}

/**
 * Parse "1d", "7d", "30d" → ms since epoch threshold.
 */
function parseSince(since) {
  if (!since) return 0;
  const match = String(since).match(/^(\d+)([dhm])$/);
  if (!match) return 0;
  const [, num, unit] = match;
  const mult = { d: 86400000, h: 3600000, m: 60000 }[unit];
  return Date.now() - parseInt(num) * mult;
}

function extractSnippet(text, match) {
  const start = Math.max(0, match.index - 100);
  const end   = Math.min(text.length, match.index + match[0].length + SNIPPET_CONTEXT);
  return text.slice(start, end).replace(/\n+/g, ' ').trim();
}

function fingerprint(snippet) {
  return snippet.slice(0, 80).toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Extract tool-call sequences (3+ consecutive successful calls) from JSONL content.
 * @param {string} jsonlContent
 * @param {string} sessionId
 * @param {string} date  — YYYY-MM-DD
 * @returns {Array<{ session: string, date: string, snippet: string }>}
 */
function extractToolSequences(jsonlContent, sessionId, date) {
  const hits  = [];
  const seen  = new Set();

  const lines   = jsonlContent.split('\n').filter(l => l.trim());
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch (_) {}
  }

  const toolCalls = [];

  function flushSequence() {
    if (toolCalls.length < 3) { toolCalls.length = 0; return; }
    const snippet = toolCalls.map(t => `[${t.name}(${t.argSummary})]`).join(' → ');
    const fp      = fingerprint(snippet);
    if (!seen.has(fp)) {
      seen.add(fp);
      hits.push({ session: sessionId, date, snippet });
    }
    toolCalls.length = 0;
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.type !== 'assistant') continue;

    for (const c of e.message?.content ?? []) {
      if (c.type !== 'tool_use') continue;

      // Check if next entry has a successful tool_result for this call
      const next    = entries[i + 1];
      const results = next?.message?.content ?? next?.content ?? [];
      const result  = Array.isArray(results)
        ? results.find(r => r.type === 'tool_result' && r.tool_use_id === c.id)
        : null;
      const isError = result?.is_error || false;

      if (!isError) {
        const argSummary = Object.entries(c.input || {})
          .slice(0, 2)
          .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
          .join(', ');
        toolCalls.push({ name: c.name, argSummary });
      } else {
        flushSequence();
      }
    }
  }
  flushSequence();

  return hits;
}

/**
 * Mine knowledge candidates from sessions + plan files.
 * @param {{ projectPath?: string, since?: string, limit?: number, cat?: string, plansOnly?: boolean }} opts
 */
async function mineSessions(opts = {}) {
  const projectPath = opts.projectPath || process.env.PWD;
  if (!projectPath) throw new Error('projectPath required (or set PWD)');

  const sinceMs  = parseSince(opts.since);
  const limit    = opts.limit || 6;
  const filterCat = opts.cat || null;
  const plansOnly = opts.plansOnly || false;

  const blocks = [];

  // Plan/brainstorm/solution files
  const planDirs = [
    { dir: path.join(os.homedir(), '.claude', 'plans'), label: 'claude-plan' },
    { dir: path.join(projectPath, 'docs', 'plans'),       label: 'ce-plan' },
    { dir: path.join(projectPath, 'docs', 'brainstorms'), label: 'ce-brainstorm' },
    { dir: path.join(projectPath, 'docs', 'solutions'),   label: 'ce-solution' },
  ];

  for (const { dir, label } of planDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const name of files) {
      const fullPath = path.join(dir, name);
      const mtime   = fs.statSync(fullPath).mtimeMs;
      if (mtime < sinceMs) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      const date    = new Date(mtime).toISOString().slice(0, 10);
      const slug    = name.replace('.md', '');
      for (const chunk of content.split(/\n{2,}/)) {
        if (chunk.trim().length >= MIN_TEXT_LEN) {
          blocks.push({ session: `${label}:${slug.slice(0, 20)}`, date, text: chunk.trim() });
        }
      }
    }
  }

  // JSONL sessions
  const workflowHits = [];

  if (!plansOnly) {
    const sessDir = sessionsDir(projectPath);
    if (fs.existsSync(sessDir)) {
      const jsonlFiles = fs.readdirSync(sessDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(sessDir, f)).mtimeMs }))
        .filter(f => f.mtime >= sinceMs)
        .sort((a, b) => a.mtime - b.mtime);

      for (const { name, mtime } of jsonlFiles) {
        const sessionId = name.slice(0, 8);
        const date      = new Date(mtime).toISOString().slice(0, 10);
        const content   = fs.readFileSync(path.join(sessDir, name), 'utf8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if (d.type !== 'assistant') continue;
            for (const c of d.message?.content ?? []) {
              if (c.type === 'text' && c.text.length >= MIN_TEXT_LEN) {
                blocks.push({ session: sessionId, date, text: c.text });
              }
            }
          } catch (_) { /* skip malformed */ }
        }

        // Tool-sequence pass (separate from text blocks)
        const seqHits = extractToolSequences(content, sessionId, new Date(mtime).toISOString().slice(0, 10));
        workflowHits.push(...seqHits);
      }
    }
  }

  const cats    = filterCat ? { [filterCat]: CATEGORIES[filterCat] } : CATEGORIES;
  const results = {};

  for (const [cat, { patterns }] of Object.entries(cats)) {
    // workflow category has no patterns — handled separately below
    if (cat === 'workflow') continue;
    const hits = [];
    const seen = new Set();
    for (const block of blocks) {
      for (const pat of patterns) {
        const match = pat.exec(block.text);
        if (!match) continue;
        const snippet = extractSnippet(block.text, match);
        const fp      = fingerprint(snippet);
        if (seen.has(fp)) continue;
        seen.add(fp);
        hits.push({ session: block.session, date: block.date, snippet });
        break;
      }
    }
    results[cat] = hits.slice(0, limit);
  }

  // Add workflow hits if category is included
  if (!filterCat || filterCat === 'workflow') {
    results['workflow'] = workflowHits.slice(0, limit);
  }

  const totalHits = Object.values(results).reduce((s, h) => s + h.length, 0);
  return {
    blocksScanned: blocks.length,
    totalHits,
    projectPath,
    results: Object.entries(results).map(([cat, hits]) => ({
      cat,
      label: CATEGORIES[cat]?.label || cat,
      emoji: CATEGORIES[cat]?.emoji || '',
      hits,
    })),
  };
}

module.exports = { mineSessions };
