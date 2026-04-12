'use strict';

/**
 * After ingesting a knowledge candidate, find related entity pages
 * and append a cross-reference note so knowledge compounds.
 *
 * Strategy:
 * 1. Extract keywords from the ingested text (split, filter stopwords, take top 5)
 * 2. Search wiki for each keyword
 * 3. For pages found (excluding /Journal/ and /log and /index), append a brief
 *    "See also" note referencing the journal entry
 * 4. Cap at 3 pages updated to avoid noise
 */

const STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'ini', 'itu', 'dari', 'ke', 'di', 'dengan', 'untuk',
  'the', 'and', 'or', 'this', 'that', 'from', 'to', 'in', 'with', 'for',
  'adalah', 'tidak', 'akan', 'bisa', 'harus', 'sudah', 'kalau', 'jika',
  'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have',
]);

function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w))
    .slice(0, 5);
}

/**
 * @param {object} client - SiYuanClient instance
 * @param {string} notebookName - resolved notebook name
 * @param {string} section - journal section (e.g. "Gotcha")
 * @param {string} text - ingested text
 * @param {string} journalDate - YYYY-MM-DD
 */
async function updateRelatedEntities(client, notebookName, section, text, journalDate) {
  const keywords = extractKeywords(text);
  if (keywords.length === 0) return;

  const nb = await client.getOrCreateNotebook(notebookName);
  const seen = new Set();
  let updated = 0;

  for (const kw of keywords) {
    if (updated >= 3) break;
    const results = await client.fullTextSearch(kw, { notebookId: nb.id, limit: 3 });
    for (const r of results) {
      if (updated >= 3) break;
      const hpath = r.hpath || r.path || '';
      // Skip journal, log, index pages — only update entity/reference pages
      if (!hpath || hpath.includes('/Journal/') || hpath.endsWith('/log') || hpath.endsWith('/index')) continue;
      if (seen.has(hpath)) continue;
      seen.add(hpath);

      // Append a brief "See also" note to the page
      const note = `\n> **See also (${journalDate}):** ${section} — ${text.slice(0, 120)}…`;
      const doc = await client.getDocByHPath(nb.id, hpath);
      if (!doc) continue;
      await client.appendBlock(doc.id, note);
      updated++;
    }
  }

  return updated;
}

module.exports = { updateRelatedEntities };
