'use strict';

/**
 * reindex — rebuild /index in the wiki as a full catalog grouped by section.
 * Also generates category sub-indexes (/index-{slug}) for folders with ≥3 pages.
 * Skips /log and /index* themselves.
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

  // Filter out /log, /index, and /index-* (sub-indexes) themselves
  const filtered = docs.filter((d) => d.hpath !== '/log' && !d.hpath.startsWith('/index'));

  // Group by top-level folder
  const groups = {};
  for (const doc of filtered) {
    // hpath like /Decisions/adr-foo or /Journal/2026-04-13 or /Gotchas/some-thing
    const parts  = doc.hpath.replace(/^\//, '').split('/');
    const folder = parts.length >= 2 ? parts[0] : 'Uncategorized';
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push(doc);
  }

  const sortedFolders = Object.keys(groups).sort();

  // ── Generate category sub-indexes for folders with ≥3 pages ────────────────
  const subIndexes = []; // { folder, slug, path, count }

  for (const folder of sortedFolders) {
    const folderDocs = groups[folder];
    if (folderDocs.length < 3) continue; // skip small folders

    const slug         = folder.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const subIndexPath = `/index-${slug}`;

    const subLines = [
      `# ${folder} Index`,
      `_Last updated: ${new Date().toISOString()}_`,
      '',
      `**${folderDocs.length} pages**`,
      '',
    ];
    for (const doc of folderDocs) {
      const summary = (doc.content || '').trim().slice(0, 120).replace(/\n/g, ' ') || '—';
      subLines.push(`- [${doc.hpath}](${doc.hpath}) — ${summary}`);
    }

    const subMarkdown = subLines.join('\n');
    const existingSub = await client.getDocByHPath(notebookId, subIndexPath);
    if (existingSub) {
      await client.updateBlock(existingSub.id, subMarkdown);
    } else {
      await client.createDocWithMd(notebookId, subIndexPath, subMarkdown);
    }

    subIndexes.push({ folder, slug, path: subIndexPath, count: folderDocs.length });
  }

  // ── Build main /index markdown ──────────────────────────────────────────────
  const now   = new Date().toISOString();
  const lines = [`# Wiki Index`, `_Last updated: ${now}_`, ''];

  // Add Sub-indexes section at the top if any exist
  if (subIndexes.length > 0) {
    lines.push('## Sub-indexes');
    for (const { folder, path: siPath, count } of subIndexes) {
      lines.push(`- [${folder}](${siPath}) — ${count} pages`);
    }
    lines.push('');
  }

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
    docsIndexed:  filtered.length,
    sections:     sortedFolders.length,
    path:         indexPath,
    subIndexes:   subIndexes.map(s => ({ path: s.path, count: s.count })),
  };
}

module.exports = { reindex };
