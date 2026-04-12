'use strict';

/**
 * createDecision — scaffold a new ADR in the specified notebook.
 * Extracted from docs/wiki/decision.js; takes explicit notebookName param.
 *
 * @param {SiYuanClient} client
 * @param {string}       notebookName  — e.g. "camis-wiki"
 * @param {string}       slug          — kebab-case identifier, e.g. "use-redis-streams"
 * @param {string}       title         — human-readable title
 * @param {string}       [body]        — optional extra markdown appended after template
 */
async function createDecision(client, notebookName, slug, title, body) {
  const notebook = await client.getOrCreateNotebook(notebookName);
  const date     = new Date().toISOString().slice(0, 10);
  const wikiPath = `/Decisions/adr-${slug}`;

  const existing = await client.getDocByHPath(notebook.id, wikiPath);
  if (existing) {
    throw new Error(`ADR already exists: ${wikiPath} (id=${existing.id})`);
  }

  const markdown = _adrSkeleton(title, date, body);

  await client.createDocWithMd(notebook.id, wikiPath, markdown);
  const doc = await client.getDocByHPath(notebook.id, wikiPath);

  await client.setBlockAttrs(doc.id, {
    'custom-wiki-type':     'decision',
    'custom-adr-slug':      slug,
    'custom-adr-status':    'proposed',
    'custom-adr-date':      date,
    'custom-last-ingested': new Date().toISOString(),
  });

  return { path: wikiPath, id: doc.id };
}

// ── Internals ──

function _adrSkeleton(title, date, body) {
  const extra = body ? `\n\n${body}` : '';
  return `# ADR: ${title}

## Status
Proposed — ${date}

## Context

_Apa situasinya? Kenapa perlu decide sekarang?_

## Decision

_Apa yang diputuskan? Harus concrete dan actionable._

## Consequences

**Didapat:**
- _trade-off positif_

**Hilang:**
- _trade-off negatif_

## Alternatives

1. **Option X** — ditolak karena ...
2. **Option Y** — ditolak karena ...

## Related

- _link ke /Integrations/..., /Infra/..., /Gotchas/... yang relevant_
${extra}`;
}

module.exports = { createDecision };
