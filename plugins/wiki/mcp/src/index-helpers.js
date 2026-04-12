'use strict';

/**
 * reindex — rebuild /index in the wiki as a full catalog grouped by section.
 * Skips /log and /index themselves.
 *
 * @param {SiYuanClient} client
 * @param {string}       notebookId  — notebook box id
 */
async function reindex(client, notebookId) {
  // Fetch all docs in the notebook
  const escapedBox = notebookId.replace(/'/g, "''");
  const docs = await client.sql(
    `SELECT id, hpath, content FROM blocks WHERE type='d' AND box='${escapedBox}' ORDER BY hpath ASC`
  );

  // Filter out /log and /index themselves
  const filtered = docs.filter((d) => d.hpath !== '/log' && d.hpath !== '/index');

  // Group by top-level folder
  const groups = {};
  for (const doc of filtered) {
    // hpath like /Decisions/adr-foo or /Journal/2026-04-13 or /Gotchas/some-thing
    const parts  = doc.hpath.replace(/^\//, '').split('/');
    const folder = parts.length >= 2 ? parts[0] : 'Uncategorized';
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push(doc);
  }

  // Build markdown
  const now  = new Date().toISOString();
  const lines = [`# Wiki Index`, `_Last updated: ${now}_`, ''];

  const sortedFolders = Object.keys(groups).sort();
  for (const folder of sortedFolders) {
    lines.push(`## ${folder}`);
    for (const doc of groups[folder]) {
      // content on type='d' is the doc title; use it as summary
      const summary = (doc.content || '').trim().slice(0, 120).replace(/\n/g, ' ') || '—';
      lines.push(`- [${doc.hpath}](${doc.hpath}) — ${summary}`);
    }
    lines.push('');
  }

  const markdown = lines.join('\n');

  // Upsert /index
  const indexPath = '/index';
  const existing  = await client.getDocByHPath(notebookId, indexPath);
  if (existing) {
    await client.updateBlock(existing.id, markdown);
  } else {
    await client.createDocWithMd(notebookId, indexPath, markdown);
  }

  return {
    docsIndexed: filtered.length,
    sections:    sortedFolders.length,
    path:        indexPath,
  };
}

module.exports = { reindex };
