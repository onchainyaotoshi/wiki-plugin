'use strict';

const { z }                   = require('zod');
const { resolveNotebook, makeClient, today } = require('./helpers');
const { journalAppend }       = require('./journal-helpers');
const { createDecision }      = require('./decision-helpers');
const { crosslink }           = require('./crosslink-helpers');
const { lintGaps, lintGraph, lintContradictions, lintStale } = require('./lint-helpers');
const { updateRelatedEntities } = require('./entity-update-helpers');
const { mineSessions }        = require('./mine-helpers');
const { suggestADR }          = require('./suggest-adr-helpers');
const { hashPaths }           = require('./hash-helpers');
const { appendLog }           = require('./log-helpers');
const { reindex }             = require('./index-helpers');

// ── Utilities ──────────────────────────────────────────────────────────────

function wrapError(err) {
  return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
}

function ok(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

// ── Tool definitions ───────────────────────────────────────────────────────

const tools = {

  // ── Read ──────────────────────────────────────────────────────────────────

  wiki_list_notebooks: {
    description: 'List all notebooks in the SiYuan wiki.',
    inputSchema: {},
    handler: async () => {
      try { return ok(await makeClient().listNotebooks()); }
      catch (err) { return wrapError(err); }
    },
  },

  wiki_search: {
    description: 'Full-text search across wiki blocks. Scoped to the resolved notebook by default.',
    inputSchema: {
      query:    z.string().describe('Search text'),
      notebook: z.string().optional().describe('Notebook name override'),
      limit:    z.number().optional().describe('Max results (default 20)'),
      save_as:  z.string().optional().describe('If provided, save search results as a new wiki page at this path'),
    },
    handler: async ({ query, notebook, limit, save_as }) => {
      try {
        const client = makeClient();
        const nbName = resolveNotebook(notebook);
        const nb     = await client.getNotebookByName(nbName);
        const results = await client.fullTextSearch(query, nb ? { notebookId: nb.id, limit } : { limit });

        if (save_as && results.length > 0) {
          // Format results as markdown and push to save_as path
          const lines = [
            `# Search: ${query}`,
            `_Saved: ${new Date().toISOString()}_`,
            '',
            `**${results.length} results**`,
            '',
          ];
          for (const r of results) {
            lines.push(`## ${r.hpath || r.id}`);
            lines.push((r.content || r.markdown || '').slice(0, 400));
            lines.push('');
          }
          const markdown = lines.join('\n');

          const saveNb = await client.getOrCreateNotebook(nbName);
          const existing = await client.getDocByHPath(saveNb.id, save_as);
          if (existing) {
            await client.updateBlock(existing.id, markdown);
          } else {
            await client.createDocWithMd(saveNb.id, save_as, markdown);
          }
          try { await appendLog(client, nbName, `[push] ${save_as}`); } catch (_) {}
        }

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
        const nb     = await client.getNotebookByName(resolveNotebook(notebook));
        if (!nb) return ok(`Notebook not found`);
        const doc = await client.getDocByHPath(nb.id, path);
        if (!doc) return ok('null');
        const { kramdown } = await client.getBlockKramdown(doc.id);
        return ok(kramdown);
      } catch (err) { return wrapError(err); }
    },
  },

  // ── Write ─────────────────────────────────────────────────────────────────

  wiki_journal_append: {
    description: "Append a bullet to a section in today's journal. Creates the doc if needed.",
    inputSchema: {
      text:     z.string().describe('Bullet body text'),
      section:  z.string().default('What Happened').describe('Section heading'),
      notebook: z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ text, section = 'What Happened', notebook }) => {
      try {
        const client   = makeClient();
        const nbName   = resolveNotebook(notebook);
        const result   = await journalAppend(client, nbName, section, text, today());
        try { await appendLog(client, nbName, `[journal] ${section}: ${text.slice(0, 80)}`); } catch (_) {}
        try { await updateRelatedEntities(client, nbName, section, text, today()); } catch (_) {}
        return ok(result);
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_decision_new: {
    description: 'Scaffold a new ADR in /Decisions/.',
    inputSchema: {
      slug:     z.string().describe('Kebab-case slug, e.g. "use-redis-streams"'),
      title:    z.string().describe('Human-readable title'),
      body:     z.string().optional().describe('Extra markdown appended after template'),
      notebook: z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ slug, title, body, notebook }) => {
      try {
        const client = makeClient();
        const nbName = resolveNotebook(notebook);
        const result = await createDecision(client, nbName, slug, title, body);
        try { await appendLog(client, nbName, `[decision] ${slug}: ${title}`); } catch (_) {}
        return ok(`Created ADR: ${result.path} (id=${result.id})`);
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_push: {
    description: 'Upsert a wiki document. Optionally track source files for lint-stale.',
    inputSchema: {
      path:         z.string().describe('Document path, e.g. /Guides/deploy'),
      markdown:     z.string().describe('Full Markdown content'),
      type:         z.string().optional().describe('custom-wiki-type, e.g. "guide"'),
      tags:         z.string().optional().describe('Comma-separated tags, e.g. "ginee,data-integrity"'),
      source_files: z.array(z.string()).optional().describe('Source file paths to hash for staleness tracking'),
      notebook:     z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ path, markdown, type, tags, source_files, notebook }) => {
      try {
        const client = makeClient();
        const nbName = resolveNotebook(notebook);
        const nb     = await client.getOrCreateNotebook(nbName);
        const existing = await client.getDocByHPath(nb.id, path);

        let docId;
        if (existing) {
          await client.updateBlock(existing.id, markdown);
          docId = existing.id;
        } else {
          await client.createDocWithMd(nb.id, path, markdown);
          const doc = await client.getDocByHPath(nb.id, path);
          docId = doc?.id;
        }

        if (docId) {
          const attrs = {};
          if (type)         attrs['custom-wiki-type']    = type;
          if (tags)         attrs['custom-tags']         = tags;
          if (source_files?.length) {
            const base = process.env.PWD || '';
            const { hash, resolvedPaths } = hashPaths(source_files, base);
            attrs['custom-source-files'] = resolvedPaths.join(',');
            attrs['custom-source-hash']  = hash;
            attrs['custom-last-ingested'] = new Date().toISOString();
          }
          if (Object.keys(attrs).length) await client.setBlockAttrs(docId, attrs);
        }

        try { await appendLog(client, nbName, `[push] ${path}`); } catch (_) {}
        try { await reindex(client, nb.id); } catch (_) {}
        return ok(`${existing ? 'Updated' : 'Created'}: ${path}`);
      } catch (err) { return wrapError(err); }
    },
  },

  // ── Maintenance ──────────────────────────────────────────────────────────

  wiki_crosslink: {
    description: 'Scan wiki and replace plain text mentions with SiYuan block refs. Run after batch ingests.',
    inputSchema: {
      notebook: z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ notebook } = {}) => {
      try {
        const client = makeClient();
        const nb     = await client.getOrCreateNotebook(resolveNotebook(notebook));
        const result = await crosslink(client, nb.id);
        // Refresh index after crosslink since this runs after batch ingests
        try { result.reindex = await reindex(client, nb.id); } catch (_) {}
        return ok(result);
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_reindex: {
    description: 'Rebuild /index — full catalog of all wiki pages grouped by section.',
    inputSchema: {
      notebook: z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ notebook } = {}) => {
      try {
        const client = makeClient();
        const nb     = await client.getOrCreateNotebook(resolveNotebook(notebook));
        return ok(await reindex(client, nb.id));
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_lint: {
    description: 'Audit wiki health. type="gaps" (undefined concepts), "graph" (orphans/hubs), "contradictions" (conflicting claims), "stale" (source files changed since ingest), "all" (all checks).',
    inputSchema: {
      type:     z.enum(['gaps', 'graph', 'contradictions', 'stale', 'all']).default('all').describe('Lint type'),
      notebook: z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ type = 'all', notebook } = {}) => {
      try {
        const client = makeClient();
        const nb     = await client.getOrCreateNotebook(resolveNotebook(notebook));
        const result = {};
        if (type === 'gaps' || type === 'all') result.gaps  = await lintGaps(client, nb.id);
        if (type === 'graph' || type === 'all') result.graph = await lintGraph(client, nb.id);
        if (type === 'contradictions' || type === 'all') result.contradictions = await lintContradictions(client, nb.id);
        if (type === 'stale' || type === 'all') result.stale = await lintStale(client, nb.id);
        return ok(result);
      } catch (err) { return wrapError(err); }
    },
  },

  // ── Project-aware (uses process.env.PWD) ─────────────────────────────────

  wiki_mine: {
    description: 'Mine Claude Code sessions and plan files for knowledge candidates. Uses PWD as project path.',
    inputSchema: {
      since:        z.string().optional().describe('Time window: "1d", "7d", "30d" (default: all)'),
      limit:        z.number().optional().describe('Max hits per category (default 6)'),
      cat:          z.string().optional().describe('Filter category: gotcha|decision|fix|pattern'),
      plans_only:   z.boolean().optional().describe('Only scan plan/brainstorm files, skip JSONL sessions'),
      project_path: z.string().optional().describe('Project root path (default: current PWD)'),
    },
    handler: async ({ since, limit, cat, plans_only, project_path } = {}) => {
      try {
        return ok(await mineSessions({ since, limit, cat, plansOnly: plans_only, projectPath: project_path }));
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_suggest_adr: {
    description: 'Mine git log for modules with significant activity but no ADR coverage.',
    inputSchema: {
      repo_path: z.string().optional().describe('Git repo path (default: current PWD)'),
      notebook:  z.string().optional().describe('Notebook name override'),
    },
    handler: async ({ repo_path, notebook } = {}) => {
      try {
        const client = makeClient();
        const nb     = await client.getOrCreateNotebook(resolveNotebook(notebook));
        return ok(await suggestADR(client, nb.id, repo_path));
      } catch (err) { return wrapError(err); }
    },
  },

  wiki_resolve_contradiction: {
    description: 'Resolve a contradiction between two wiki pages. Marks the losing page as superseded.',
    inputSchema: {
      keep_path:      z.string().describe('Path of the page to keep as authoritative'),
      supersede_path: z.string().describe('Path of the page to mark as superseded'),
      reason:         z.string().optional().describe('Why this resolution was chosen'),
      notebook:       z.string().optional(),
    },
    handler: async ({ keep_path, supersede_path, reason, notebook }) => {
      try {
        const client = makeClient();
        const nb     = await client.getOrCreateNotebook(resolveNotebook(notebook));
        const doc    = await client.getDocByHPath(nb.id, supersede_path);
        if (!doc) return ok(`Page not found: ${supersede_path}`);
        const note = `\n> ⚠️ **SUPERSEDED** by [${keep_path}](${keep_path})${reason ? ` — ${reason}` : ''}`;
        await client.appendBlock(doc.id, note);
        await appendLog(client, resolveNotebook(notebook), `[resolve] ${supersede_path} superseded by ${keep_path}`);
        return ok(`Marked ${supersede_path} as superseded by ${keep_path}`);
      } catch (err) { return wrapError(err); }
    },
  },

};

module.exports = { tools };
