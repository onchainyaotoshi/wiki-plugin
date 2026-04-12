'use strict';

/**
 * Crosslink wiki pages — replace plain text mentions of other wiki pages
 * with SiYuan block refs so the graph view populates.
 * Ported from docs/wiki/crosslink.js (no project coupling).
 */

function deriveAliases(slug, h1Title) {
  const aliases = new Set();
  aliases.add(slug);

  if (h1Title) {
    const title = h1Title.replace(/^#+\s*/, '').trim();
    aliases.add(title);
    const keyPhrase = title.split(/\s*[—:–(]\s*/)[0].trim();
    if (keyPhrase && keyPhrase !== title) aliases.add(keyPhrase);
  }

  const normalized = slug.replace(/^adr-/, '').replace(/^menu-/, '');
  aliases.add(normalized.replace(/[-_]/g, ' '));
  aliases.add(normalized.replace(/[-_]/g, '_').toUpperCase());

  return Array.from(aliases).filter(a => a.length >= 4);
}

async function crosslink(client, notebookId) {
  const docs = await client.sql(
    `SELECT id, hpath FROM blocks WHERE type='d' AND box='${notebookId}' AND ial LIKE '%custom-wiki-type%'`
  );

  const aliasMap = new Map();
  const docInfo  = {};

  for (const doc of docs) {
    const slug      = doc.hpath.split('/').pop();
    const escapedId = doc.id.replace(/'/g, "''");
    const h1Blocks  = await client.sql(
      `SELECT markdown FROM blocks WHERE root_id='${escapedId}' AND type='h' AND subtype='h1' LIMIT 1`
    );
    const h1Title = h1Blocks[0]?.markdown || '';
    const aliases = deriveAliases(slug, h1Title);
    docInfo[doc.id] = { slug, aliases, hpath: doc.hpath };

    for (const alias of aliases) {
      const existing = aliasMap.get(alias.toLowerCase());
      if (!existing || alias.length > existing.alias.length) {
        aliasMap.set(alias.toLowerCase(), { docId: doc.id, slug, alias });
      }
    }
  }

  const sortedAliases = Array.from(aliasMap.values())
    .sort((a, b) => b.alias.length - a.alias.length);

  const blocks = await client.sql(
    `SELECT id, type, root_id, markdown FROM blocks
     WHERE box='${notebookId}' AND type IN ('p','h','i','t')
     AND markdown IS NOT NULL AND markdown != ''
     ORDER BY root_id, id
     LIMIT 100000`
  );

  let totalRefs    = 0;
  let blocksUpdated = 0;

  for (const block of blocks) {
    let markdown  = block.markdown;
    let modified  = false;
    const linkedDocs = new Set([block.root_id]);

    for (const entry of sortedAliases) {
      if (linkedDocs.has(entry.docId)) continue;

      const escaped = entry.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex   = new RegExp(`(?<![\\w/-])\\b${escaped}\\b(?![\\w/-])`, 'i');
      const match   = markdown.match(regex);
      if (!match) continue;

      const before      = markdown.slice(0, match.index);
      const backticks   = (before.match(/`/g) || []).length;
      if (backticks % 2 === 1) continue;

      const parenOpens  = (before.match(/\(\(/g) || []).length;
      const parenCloses = (before.match(/\)\)/g) || []).length;
      if (parenOpens > parenCloses) continue;

      const brackOpens  = (before.match(/\[/g) || []).length;
      const brackCloses = (before.match(/\]/g) || []).length;
      if (brackOpens > brackCloses) continue;

      const ref = `((${entry.docId} "${match[0]}"))`;
      markdown  = markdown.slice(0, match.index) + ref + markdown.slice(match.index + match[0].length);
      linkedDocs.add(entry.docId);
      totalRefs++;
      modified = true;
    }

    if (modified) {
      try {
        await client.updateBlock(block.id, markdown);
        blocksUpdated++;
      } catch (_) { /* skip */ }
    }
  }

  const refCount = await client.sql(
    `SELECT COUNT(*) as total FROM refs WHERE box='${notebookId}'`
  );

  return {
    docsScanned:   docs.length,
    aliasesBuilt:  aliasMap.size,
    blocksScanned: blocks.length,
    refsAdded:     totalRefs,
    blocksUpdated,
    totalWikiRefs: refCount[0].total,
  };
}

module.exports = { crosslink };
