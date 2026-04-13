'use strict';

async function setConfidence(client, docId, opts = {}) {
  const attrs = {};

  if (opts.confidence !== undefined) {
    attrs['custom-confidence'] = String(Math.round(opts.confidence * 100) / 100);
  }

  if (opts.sources !== undefined) {
    attrs['custom-sources'] = String(opts.sources);
  }

  const lastConfirmed = opts.lastConfirmed !== undefined
    ? opts.lastConfirmed
    : (opts.confidence !== undefined || opts.sources !== undefined ? new Date().toISOString() : undefined);

  if (lastConfirmed !== undefined) {
    attrs['custom-last-confirmed'] = lastConfirmed;
  }

  if (Object.keys(attrs).length > 0) {
    await client.setBlockAttrs(docId, attrs);
  }
}

async function getConfidenceAttrs(client, docId) {
  const safeId = docId.replace(/'/g, "''");
  const stmt = `SELECT name, value FROM attributes WHERE block_id='${safeId}' AND name IN ('custom-confidence','custom-sources','custom-last-confirmed')`;
  const rows = await client.sql(stmt);

  const result = { confidence: null, sources: null, lastConfirmed: null };

  for (const row of rows) {
    if (row.name === 'custom-confidence') {
      const parsed = parseFloat(row.value);
      result.confidence = isNaN(parsed) ? null : parsed;
    } else if (row.name === 'custom-sources') {
      const parsed = parseInt(row.value, 10);
      result.sources = isNaN(parsed) ? null : parsed;
    } else if (row.name === 'custom-last-confirmed') {
      result.lastConfirmed = row.value || null;
    }
  }

  return result;
}

async function lintLowConfidence(client, notebookId, threshold = 0.5) {
  const safeNotebook = notebookId.replace(/'/g, "''");
  const stmt = `SELECT b.hpath, b.id,
  a.value as confidence,
  (SELECT value FROM attributes WHERE name='custom-sources' AND block_id=b.id LIMIT 1) as sources,
  (SELECT value FROM attributes WHERE name='custom-last-confirmed' AND block_id=b.id LIMIT 1) as last_confirmed
FROM blocks b
JOIN attributes a ON a.block_id = b.id
WHERE b.type='d' AND b.box='${safeNotebook}' AND a.name='custom-confidence'`;

  const rows = await client.sql(stmt);

  return rows
    .filter(row => parseFloat(row.confidence) < threshold)
    .map(row => ({
      hpath: row.hpath,
      confidence: parseFloat(row.confidence),
      sources: row.sources !== null && row.sources !== undefined ? parseInt(row.sources, 10) : null,
      lastConfirmed: row.last_confirmed || null,
    }));
}

module.exports = { setConfidence, getConfidenceAttrs, lintLowConfidence };
