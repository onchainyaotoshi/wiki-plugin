'use strict';

/**
 * Retrieval feedback tracking — records when wiki pages are actively used
 * via a custom block attribute `custom-last-useful`.
 */

/**
 * Record that a wiki page was useful (fire-and-forget).
 * @param {SiYuanClient} client
 * @param {string}       notebookName
 * @param {string}       hpath          — e.g. "/Decisions/adr-foo"
 */
async function recordPageUseful(client, notebookName, hpath) {
  try {
    const nb = await client.getNotebookByName(notebookName);
    if (!nb) return;
    const doc = await client.getDocByHPath(nb.id, hpath);
    if (!doc) return;
    await client.setBlockAttrs(doc.id, {
      'custom-last-useful': new Date().toISOString(),
    });
  } catch (_) {} // fire-and-forget — never throw
}

/**
 * Get how many days ago a wiki page was last accessed (null if never).
 * @param {SiYuanClient} client
 * @param {string}       notebookName
 * @param {string}       hpath
 * @returns {Promise<number|null>}
 */
async function getUsefulnessScore(client, notebookName, hpath) {
  try {
    const nb = await client.getNotebookByName(notebookName);
    if (!nb) return null;
    const doc = await client.getDocByHPath(nb.id, hpath);
    if (!doc) return null;
    const escapedId = doc.id.replace(/'/g, "''");
    const rows = await client.sql(
      `SELECT value FROM attributes WHERE block_id='${escapedId}' AND name='custom-last-useful' LIMIT 1`
    );
    if (!rows || rows.length === 0) return null;
    const lastUseful = new Date(rows[0].value);
    const daysSince  = (Date.now() - lastUseful.getTime()) / 86400000;
    return Math.round(daysSince);
  } catch (_) { return null; }
}

module.exports = { recordPageUseful, getUsefulnessScore };
