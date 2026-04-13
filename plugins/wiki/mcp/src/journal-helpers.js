'use strict';

/**
 * journalAppend — append a bullet to a section in today's journal.
 * Extracted from docs/wiki/journal.js; takes explicit notebookName param.
 *
 * @param {SiYuanClient} client
 * @param {string}       notebookName  — e.g. "camis-wiki"
 * @param {string}       section       — heading text, e.g. "What Happened"
 * @param {string}       text          — bullet body
 * @param {string}       date          — YYYY-MM-DD
 */
async function journalAppend(client, notebookName, section, text, date) {
  const notebook = await client.getOrCreateNotebook(notebookName);
  const doc      = await _getOrCreateJournal(client, notebook.id, date);

  const childBlocks = await client.getChildBlocks(doc.id);

  // Enrich with markdown content
  const blocks = [];
  for (const b of childBlocks) {
    const escapedId = b.id.replace(/'/g, "''");
    const detail = await client.sql(
      `SELECT id, type, subtype, markdown FROM blocks WHERE id='${escapedId}' LIMIT 1`
    );
    if (detail[0]) blocks.push(detail[0]);
  }

  // Find the section heading
  const sectionLower = section.toLowerCase();
  const sectionIdx = blocks.findIndex(
    (b) =>
      b.type === 'h' &&
      b.markdown &&
      b.markdown.replace(/^#+\s*/, '').trim().toLowerCase() === sectionLower
  );

  if (sectionIdx === -1) {
    const available = blocks
      .filter((b) => b.type === 'h')
      .map((b) => b.markdown.replace(/^#+\s*/, '').trim())
      .join(', ');
    throw new Error(`Section "${section}" not found. Available: ${available}`);
  }

  // Find next heading (or end)
  let nextHeadingIdx = blocks.length;
  for (let i = sectionIdx + 1; i < blocks.length; i++) {
    if (blocks[i].type === 'h') { nextHeadingIdx = i; break; }
  }

  // Find last non-placeholder block in section
  let lastInSection = sectionIdx;
  for (let i = sectionIdx + 1; i < nextHeadingIdx; i++) {
    if (blocks[i].markdown && blocks[i].markdown.trim() !== '_TODO_') {
      lastInSection = i;
    }
  }

  // Build bullet
  const now = new Date();
  const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const bullet = `* **${timestamp}** — ${text}`;

  // Delete _TODO_ placeholder if present under this section
  for (let i = sectionIdx + 1; i < nextHeadingIdx; i++) {
    if (blocks[i].markdown && blocks[i].markdown.trim() === '_TODO_') {
      try { await client.deleteBlock(blocks[i].id); } catch (_) { /* ignore */ }
    }
  }

  // Insert new bullet after section heading or after last content
  const insertResult = await client.insertBlock(blocks[lastInSection].id, bullet);
  // insertBlock returns an array of { doOperations: [{ id, ... }] }
  let blockId = null;
  try {
    blockId = (insertResult?.[0]?.doOperations?.[0]?.id) || null;
  } catch (_) {}
  return {
    message: `[journal ${date}] appended to "${section}": ${text}`,
    blockId,
  };
}

// ── Internals ──

const JOURNAL_SECTIONS = ['What Happened', 'Blockers / Open Questions', 'Next'];

function _journalSkeleton(date) {
  const lines = [`# Journal ${date}`, ''];
  for (const section of JOURNAL_SECTIONS) {
    lines.push(`## ${section}`, '', '_TODO_', '');
  }
  return lines.join('\n');
}

async function _getOrCreateJournal(client, notebookId, date) {
  const path     = `/Journal/${date}`;
  const existing = await client.getDocByHPath(notebookId, path);
  if (existing) return existing;

  await client.createDocWithMd(notebookId, path, _journalSkeleton(date));
  const doc = await client.getDocByHPath(notebookId, path);
  await client.setBlockAttrs(doc.id, {
    'custom-wiki-type':       'journal',
    'custom-journal-date':    date,
    'custom-last-ingested':   new Date().toISOString(),
  });
  return doc;
}

module.exports = { journalAppend };
