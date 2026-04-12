'use strict';

const { z }              = require('zod');
const { resolveNotebook, makeClient, today } = require('./helpers');
const { journalAppend }  = require('./journal-helpers');
const { createDecision } = require('./decision-helpers');

// ── Error wrapper ──

function wrapError(err) {
  return {
    content: [{ type: 'text', text: `Error: ${err.message}` }],
    isError: true,
  };
}

function ok(text) {
  const out = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
  return { content: [{ type: 'text', text: out }] };
}

// ── Tool definitions ──

const tools = {

  wiki_list_notebooks: {
    description: 'List all notebooks in the SiYuan wiki.',
    inputSchema: {},
    handler: async () => {
      try {
        const client    = makeClient();
        const notebooks = await client.listNotebooks();
        return ok(notebooks);
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_search: {
    description: 'Full-text search across wiki blocks. Scoped to the resolved notebook by default.',
    inputSchema: {
      query:    z.string().describe('Search text'),
      notebook: z.string().optional().describe('Notebook name override (default: WIKI_DEFAULT_NOTEBOOK)'),
      limit:    z.number().optional().describe('Max results (default 20)'),
    },
    handler: async ({ query, notebook, limit }) => {
      try {
        const client = makeClient();
        const nbName = resolveNotebook(notebook);
        const nb     = await client.getNotebookByName(nbName);
        const results = await client.fullTextSearch(
          query,
          nb ? { notebookId: nb.id, limit } : { limit }
        );
        return ok(results);
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_get: {
    description: 'Get a wiki document by path and return its Markdown content.',
    inputSchema: {
      path:     z.string().describe('Document path, e.g. /Decisions/adr-foo'),
      notebook: z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ path, notebook }) => {
      try {
        const client = makeClient();
        const nbName = resolveNotebook(notebook);
        const nb     = await client.getNotebookByName(nbName);
        if (!nb) return ok(`Notebook "${nbName}" not found`);
        const doc    = await client.getDocByHPath(nb.id, path);
        if (!doc) return ok('null');
        const { kramdown } = await client.getBlockKramdown(doc.id);
        return ok(kramdown);
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_journal_append: {
    description: "Append a bullet to a section in today's journal entry. Creates the journal doc if it doesn't exist.",
    inputSchema: {
      text:     z.string().describe('Bullet body text'),
      section:  z.string().default('What Happened').describe('Section heading to append under'),
      notebook: z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ text, section = 'What Happened', notebook }) => {
      try {
        const client = makeClient();
        const nbName = resolveNotebook(notebook);
        const date   = today();
        const result = await journalAppend(client, nbName, section, text, date);
        return ok(result);
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_decision_new: {
    description: 'Scaffold a new ADR (Architecture Decision Record) in /Decisions/.',
    inputSchema: {
      slug:     z.string().describe('Kebab-case slug, e.g. "use-redis-streams"'),
      title:    z.string().describe('Human-readable title'),
      body:     z.string().optional().describe('Optional extra markdown appended after template'),
      notebook: z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ slug, title, body, notebook }) => {
      try {
        const client = makeClient();
        const nbName = resolveNotebook(notebook);
        const result = await createDecision(client, nbName, slug, title, body);
        return ok(`Created ADR: ${result.path} (id=${result.id})`);
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_push: {
    description: 'Upsert a wiki document by path. Updates if exists, creates if not.',
    inputSchema: {
      path:     z.string().describe('Document path, e.g. /Guides/deploy'),
      markdown: z.string().describe('Full Markdown content for the document'),
      type:     z.string().optional().describe('custom-wiki-type attribute value, e.g. "guide"'),
      notebook: z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ path, markdown, type, notebook }) => {
      try {
        const client = makeClient();
        const nbName = resolveNotebook(notebook);
        const nb     = await client.getOrCreateNotebook(nbName);
        const existing = await client.getDocByHPath(nb.id, path);

        if (existing) {
          await client.updateBlock(existing.id, markdown);
          if (type) await client.setBlockAttrs(existing.id, { 'custom-wiki-type': type });
          return ok(`Updated: ${path}`);
        } else {
          await client.createDocWithMd(nb.id, path, markdown);
          if (type) {
            const doc = await client.getDocByHPath(nb.id, path);
            if (doc) await client.setBlockAttrs(doc.id, { 'custom-wiki-type': type });
          }
          return ok(`Created: ${path}`);
        }
      } catch (err) { return wrapError(err); }
    },
  },

};

module.exports = { tools };
