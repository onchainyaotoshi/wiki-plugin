'use strict';

/**
 * appendLog — append a single bullet to /log in the wiki.
 * Append-only ops log: records every write operation chronologically.
 *
 * Entry format:
 *   - {ISO datetime} [{op}] {detail}
 *
 * @param {SiYuanClient} client
 * @param {string}       notebookName  — e.g. "camis-api-native-wiki"
 * @param {string}       entry         — e.g. "[journal] What Happened: some text"
 */
async function appendLog(client, notebookName, entry) {
  const notebook = await client.getOrCreateNotebook(notebookName);
  const logPath  = '/log';

  let doc = await client.getDocByHPath(notebook.id, logPath);
  if (!doc) {
    await client.createDocWithMd(notebook.id, logPath, '# Ops Log\n');
    doc = await client.getDocByHPath(notebook.id, logPath);
  }

  const ts     = new Date().toISOString();
  const bullet = `- ${ts} ${entry}`;

  await client.appendBlock(doc.id, bullet);
}

module.exports = { appendLog };
