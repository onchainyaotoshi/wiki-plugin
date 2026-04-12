'use strict';

/**
 * ADR suggestion — mine git log for undocumented architectural decisions.
 * Ported from docs/wiki/suggest-adr.js.
 * Uses process.env.PWD as default repo path.
 */

const { execSync } = require('child_process');

const DAYS_BACK = 30;
const MIN_COMMITS = 3;
const DECISION_KEYWORDS = [
  'refactor', 'migrate', 'migrat', 'switch', 'replace', 'rewrite',
  'remove', 'drop', 'deprecat', 'redesign', 'restructur', 'consolidat',
];

function gitLog(repoPath, since) {
  const raw = execSync(
    `git log --since="${since}" --name-only --format="COMMIT%n%H%n%s%n%b%nENDMSG"`,
    { cwd: repoPath, encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 }
  );

  const commits = [];
  for (const part of raw.split('COMMIT\n').filter(Boolean)) {
    const lines  = part.split('\n');
    const hash   = lines[0];
    const subject = lines[1] || '';
    const endIdx = lines.indexOf('ENDMSG');
    const body   = lines.slice(2, endIdx).join('\n');
    const files  = lines.slice(endIdx + 1).filter(l => l.trim() && !l.startsWith('COMMIT'));
    commits.push({ hash, subject, body, files });
  }
  return commits;
}

function topLevelModule(filepath) {
  const parts = filepath.split('/');
  if (parts[0] === 'modules' && parts.length >= 3) {
    return parts.slice(0, Math.min(4, parts.length - 1)).join('/');
  }
  if (['docs', 'scripts', 'services'].includes(parts[0])) {
    return parts.slice(0, 2).join('/');
  }
  if (parts[0] === '.' || parts[0] === '') return '';
  return parts[0];
}

function hasDecisionKeyword(text) {
  const lower = text.toLowerCase();
  return DECISION_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Suggest ADR topics based on recent git activity.
 * @param {SiYuanClient} client
 * @param {string} notebookId
 * @param {string} [repoPath] — defaults to process.env.PWD
 */
async function suggestADR(client, notebookId, repoPath) {
  const root = repoPath || process.env.PWD;
  if (!root) throw new Error('repoPath required (or set PWD)');

  const since   = `${DAYS_BACK}.days.ago`;
  const commits = gitLog(root, since);

  if (commits.length === 0) {
    return { windowDays: DAYS_BACK, totalCommits: 0, suggestions: [], existingADRs: [] };
  }

  // Aggregate per module
  const activity = {};
  for (const c of commits) {
    const modules = new Set();
    for (const f of c.files) {
      const mod = topLevelModule(f);
      if (mod) modules.add(mod);
    }
    const kw = hasDecisionKeyword(c.subject + ' ' + c.body);
    for (const mod of modules) {
      if (!activity[mod]) {
        activity[mod] = { count: 0, subjects: [], keywordCount: 0, files: new Set() };
      }
      activity[mod].count++;
      activity[mod].subjects.push(c.subject);
      if (kw) activity[mod].keywordCount++;
      for (const f of c.files) activity[mod].files.add(f);
    }
  }

  const scored = Object.entries(activity)
    .map(([mod, a]) => ({ module: mod, ...a, score: a.count + a.keywordCount * 2 }))
    .filter(s => s.count >= MIN_COMMITS || s.keywordCount >= 1)
    .sort((a, b) => b.score - a.score);

  const packageChurn = commits.filter(c => c.files.includes('package.json')).length;

  // Cross-check existing ADRs
  const existingADRs = await client.sql(
    `SELECT id, hpath FROM blocks WHERE type='d' AND box='${notebookId}'
     AND ial LIKE '%custom-wiki-type="decision"%' LIMIT 1000`
  );

  const adrContents = [];
  for (const adr of existingADRs) {
    const { kramdown } = await client.getBlockKramdown(adr.id);
    adrContents.push({ hpath: adr.hpath, content: kramdown.toLowerCase() });
  }

  function moduleHasADR(modulePath) {
    const keywords = modulePath.split('/').filter(p => p.length > 3);
    return adrContents.some(adr => keywords.some(kw => adr.content.includes(kw.toLowerCase())));
  }

  const suggestions = scored
    .filter(s => !moduleHasADR(s.module))
    .slice(0, 10)
    .map(s => ({
      module:          s.module,
      commits:         s.count,
      decisionKeywords: s.keywordCount,
      sampleSubjects:  s.subjects.slice(0, 3),
      filesTouched:    s.files.size,
    }));

  return {
    windowDays:      DAYS_BACK,
    totalCommits:    commits.length,
    packageJsonChurn: packageChurn,
    suggestions,
    existingADRs:    existingADRs.map(a => a.hpath),
  };
}

module.exports = { suggestADR };
