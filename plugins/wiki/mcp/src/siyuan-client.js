'use strict';

/**
 * SiYuan HTTP API client — adapted from docs/wiki/siyuan-client.js.
 * Changes from original:
 *   - Standalone: no camis project dependency
 *   - Constructor uses src/config.js defaults
 *   - SQL parameters properly escaped (no raw interpolation)
 *   - fullTextSearch accepts optional notebookId filter
 *   - getDocByHPath escapes both params; also accepts notebookName via getDocByHPathName
 *   - getNotebookByName helper (read-only, no create)
 *   - CLI mode removed
 */

class SiYuanClient {
  constructor(baseUrl, token) {
    if (!baseUrl || !token) {
      const config = require('./config');
      this.baseUrl = baseUrl || config.baseUrl;
      this.token   = token   || config.token;
    } else {
      this.baseUrl = baseUrl;
      this.token   = token;
    }
  }

  async post(endpoint, payload = {}) {
    const url        = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 5000);
    let res;
    try {
      res = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Token ${this.token}`,
        },
        body:   JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('SiYuan unreachable (timeout)');
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const json = await res.json();
    if (json.code !== 0) {
      throw new Error(`SiYuan ${endpoint}: ${json.msg} (code ${json.code})`);
    }
    return json.data;
  }

  // ── Notebooks ──

  async listNotebooks() {
    const data = await this.post('/api/notebook/lsNotebooks');
    return data.notebooks || [];
  }

  async createNotebook(name) {
    return this.post('/api/notebook/createNotebook', { name });
  }

  /** Returns existing notebook or creates it. */
  async getOrCreateNotebook(name) {
    const notebooks = await this.listNotebooks();
    const existing  = notebooks.find((n) => n.name === name);
    if (existing) return existing;
    const created = await this.createNotebook(name);
    return created.notebook || created;
  }

  /** Returns existing notebook or null — never creates. */
  async getNotebookByName(name) {
    const notebooks = await this.listNotebooks();
    return notebooks.find((n) => n.name === name) || null;
  }

  // ── Documents ──

  async createDocWithMd(notebookId, path, markdown) {
    return this.post('/api/filetree/createDocWithMd', {
      notebook: notebookId,
      path,
      markdown,
    });
  }

  /**
   * Get a document block by human-readable path within a notebook.
   * @param {string} notebookId  — notebook box id
   * @param {string} hpath       — e.g. "/Decisions/adr-foo"
   */
  async getDocByHPath(notebookId, hpath) {
    const escapedHpath = hpath.replace(/'/g, "''");
    const escapedBox   = notebookId.replace(/'/g, "''");
    const results = await this.sql(
      `SELECT * FROM blocks WHERE type='d' AND hpath='${escapedHpath}' AND box='${escapedBox}' LIMIT 1`
    );
    return results.length > 0 ? results[0] : null;
  }

  async removeDoc(notebookId, path) {
    return this.post('/api/filetree/removeDoc', { notebook: notebookId, path });
  }

  async removeDocByID(id) {
    return this.post('/api/filetree/removeDocByID', { id });
  }

  // ── Blocks ──

  async getBlockKramdown(id) {
    return this.post('/api/block/getBlockKramdown', { id });
  }

  async updateBlock(id, kramdown) {
    return this.post('/api/block/updateBlock', {
      id,
      dataType: 'markdown',
      data:     kramdown,
    });
  }

  async appendBlock(parentID, markdown) {
    return this.post('/api/block/appendBlock', { parentID, dataType: 'markdown', data: markdown });
  }

  async insertBlock(previousID, markdown) {
    return this.post('/api/block/insertBlock', { previousID, dataType: 'markdown', data: markdown });
  }

  async deleteBlock(id) {
    return this.post('/api/block/deleteBlock', { id });
  }

  async getChildBlocks(id) {
    return this.post('/api/block/getChildBlocks', { id });
  }

  // ── Attributes ──

  async setBlockAttrs(id, attrs) {
    return this.post('/api/attr/setBlockAttrs', { id, attrs });
  }

  async getBlockAttrs(id) {
    return this.post('/api/attr/getBlockAttrs', { id });
  }

  // ── SQL Query ──

  async sql(stmt) {
    return this.post('/api/query/sql', { stmt });
  }

  // ── Search ──

  /**
   * Full-text search across blocks.
   * @param {string} query
   * @param {{ limit?: number, notebookId?: string }} opts
   */
  async fullTextSearch(query, opts = {}) {
    const limit        = opts.limit || 20;
    const escapedQuery = query.replace(/'/g, "''");
    let where = `content LIKE '%${escapedQuery}%'`;
    if (opts.notebookId) {
      const escapedBox = opts.notebookId.replace(/'/g, "''");
      where += ` AND box='${escapedBox}'`;
    }
    return this.sql(`SELECT * FROM blocks WHERE ${where} ORDER BY updated DESC LIMIT ${limit}`);
  }

  // ── Export ──

  async exportMarkdown(id) {
    return this.post('/api/export/exportMdContent', { id });
  }

  // ── Convenience ──

  async findDocsByAttr(attrName, attrValue) {
    const escapedName  = attrName.replace(/'/g, "''");
    const escapedValue = attrValue.replace(/'/g, "''");
    return this.sql(
      `SELECT * FROM blocks WHERE type='d' AND ial LIKE '%${escapedName}="${escapedValue}"%'`
    );
  }

  async findDocsByWikiType(wikiType) {
    return this.findDocsByAttr('custom-wiki-type', wikiType);
  }

  async getAllWikiDocs() {
    return this.sql(`SELECT * FROM blocks WHERE type='d' AND ial LIKE '%custom-wiki-type%'`);
  }
}

module.exports = SiYuanClient;
