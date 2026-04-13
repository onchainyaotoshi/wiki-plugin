'use strict';

/**
 * getContextForPaths — search wiki for pages relevant to the given file paths.
 * Used by wiki_context_for_path tool and the PreToolUse hook.
 *
 * @param {SiYuanClient} client
 * @param {string}       notebookName
 * @param {string[]}     filePaths
 * @returns {Promise<Array<{ hpath: string, content: string }>>}
 */
async function getContextForPaths(client, notebookName, filePaths) {
  const nb = await client.getNotebookByName(notebookName);
  if (!nb) return [];

  const seen    = new Set();
  const results = [];

  for (const fp of filePaths.slice(0, 5)) {
    const parts = fp.replace(/\\/g, '/').split('/').filter(Boolean);
    const queries = [
      parts[parts.length - 1],                          // filename
      parts[parts.length - 2],                          // parent dir
      parts[parts.length - 1].replace(/\.[^.]+$/, ''), // filename without extension
    ].filter(Boolean);

    for (const q of queries) {
      if (q.length < 3) continue;
      const hits = await client.fullTextSearch(q, { notebookId: nb.id, limit: 2 });
      for (const h of hits) {
        const key = h.hpath || h.path || '';
        if (!key || seen.has(key)) continue;
        // Skip journal and index pages — they are meta, not knowledge
        if (key.includes('/Journal/') || key.startsWith('/index')) continue;
        seen.add(key);
        results.push({ hpath: key, content: (h.content || '').slice(0, 200) });
        if (results.length >= 5) return results;
      }
    }
  }

  return results;
}

module.exports = { getContextForPaths };
