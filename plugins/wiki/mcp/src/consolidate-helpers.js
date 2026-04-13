'use strict';

/**
 * Journal consolidation helpers — scan recent journal pages and surface
 * recurring topics as promotion candidates for Claude to review.
 *
 * This helper does NOT summarize or decide. It groups raw signals and
 * returns structured data for Claude to evaluate.
 */

// ── Constants ─────────────────────────────────────────────────────────────

/** Bullet-point line prefixes */
const BULLET_RE = /^[-*]\s+(.+)$/;

/**
 * Topic keyword patterns (applied to cleaned bullet text).
 * Ordered from most specific to least.
 */
const TOPIC_PATTERNS = [
  /\b([A-Z][a-zA-Z]{3,})\b/g,           // PascalCase / CapitalizedWord
  /\b([a-z]+-[a-z]+[a-z-]*)\b/g,        // kebab-case (2+ segments)
];

/** Terms that are too generic to be useful topics. */
const STOP_TERMS = new Set([
  'TODO','FIXME','NOTE','WARNING','This','That','With','From','Also',
  'When','Then','After','Before','Should','Could','Would','Into',
  'More','Some','Each','Have','Been','Will','They','Their','There',
  'JSON','HTML','HTTP','HTTPS','REST','NULL','True','False','None',
  'Error','Class','File','Type','Name','Data','Item','List','Info',
  'Code','Part','Line','Mode','Time','Date','Args','Opts','Keys',
  'Bool','Init','Load','Save','Test','Build','Push','Pull','Repo',
]);

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Format a Date as a 14-char SiYuan timestamp string: YYYYMMDDHHMMSS.
 * @param {Date} d
 * @returns {string}
 */
function formatSiYuanTimestamp(d) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Strip common markdown syntax from a line of text.
 * @param {string} line
 * @returns {string}
 */
function stripMarkdown(line) {
  return line
    .replace(/!\[.*?\]\(.*?\)/g, '')           // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links → text
    .replace(/`{1,3}[^`]*`{1,3}/g, '')         // inline code / fenced
    .replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1')   // bold/italic
    .replace(/_{1,3}([^_]*)_{1,3}/g, '$1')     // underscores
    .replace(/~~[^~]*~~/g, '')                  // strikethrough
    .replace(/^#+\s+/, '')                      // heading markers
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract topic keywords from a cleaned text line.
 * Returns an array of unique topic strings.
 * @param {string} text — already stripped of markdown
 * @returns {string[]}
 */
function extractTopics(text) {
  const found = new Set();
  for (const pat of TOPIC_PATTERNS) {
    // Reset lastIndex for global regex
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(text)) !== null) {
      const word = m[1];
      if (word.length >= 4 && !STOP_TERMS.has(word)) {
        found.add(word);
      }
    }
  }
  return [...found];
}

/**
 * Convert a topic keyword to a PascalCase wiki path segment.
 * Examples:
 *   "redis-caching"  → "RedisCaching"
 *   "Redis"          → "Redis"
 *   "myTopic"        → "MyTopic"
 * @param {string} topic
 * @returns {string}
 */
function toPascalCase(topic) {
  return topic
    .split('-')
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Scan journal pages from the last N days, find topics that recur across
 * multiple journal entries, and return them as promotion candidates.
 *
 * @param {object} client       — SiYuan client (client.sql, client.getBlockKramdown)
 * @param {string} notebookId   — notebook box id
 * @param {object} [opts]
 * @param {number} [opts.since=14]            — days to look back
 * @param {number} [opts.minOccurrences=2]    — minimum distinct journal days
 * @param {number} [opts.limit=10]            — max candidates to return
 * @returns {Promise<{
 *   daysScanned: number,
 *   journalPagesFound: number,
 *   candidates: Array<{
 *     topic: string,
 *     occurrences: number,
 *     dates: string[],
 *     excerpts: string[],
 *     suggestedPath: string,
 *   }>
 * }>}
 */
async function consolidateJournal(client, notebookId, opts = {}) {
  const since          = opts.since          !== undefined ? opts.since          : 14;
  const minOccurrences = opts.minOccurrences !== undefined ? opts.minOccurrences : 2;
  const limit          = opts.limit          !== undefined ? opts.limit          : 10;

  // ── 1. Query journal doc blocks ─────────────────────────────────────────

  const cutoff    = new Date(Date.now() - since * 86400000);
  const cutoffStr = formatSiYuanTimestamp(cutoff);
  const escapedBox = notebookId.replace(/'/g, "''");

  const docs = await client.sql(
    `SELECT id, hpath FROM blocks WHERE type='d' AND box='${escapedBox}' AND hpath LIKE '/Journal/%' AND updated >= '${cutoffStr}' ORDER BY updated DESC LIMIT 60`
  );

  if (!docs || docs.length === 0) {
    return { daysScanned: since, journalPagesFound: 0, candidates: [] };
  }

  // ── 2. Fetch kramdown for each doc ──────────────────────────────────────

  /**
   * topic → { days: Set<string>, excerpts: string[] }
   * @type {Map<string, { days: Set<string>, excerpts: string[] }>}
   */
  const topicMap = new Map();

  for (const doc of docs) {
    // Extract date from hpath like "/Journal/2026-04-13"
    const hpathParts = doc.hpath.split('/');
    const journalDate = hpathParts[hpathParts.length - 1]; // e.g. "2026-04-13"

    let kramdown;
    try {
      const result = await client.getBlockKramdown(doc.id);
      kramdown = result && result.kramdown ? result.kramdown : '';
    } catch (_) {
      kramdown = '';
    }

    if (!kramdown) continue;

    // ── 3. Extract topics from bullet-point lines ──────────────────────────

    // Track topics already seen in THIS journal day (for dedup within same day)
    const seenThisDay = new Set();

    const lines = kramdown.split('\n');
    for (const rawLine of lines) {
      const bulletMatch = BULLET_RE.exec(rawLine.trim());
      if (!bulletMatch) continue;

      const cleanText   = stripMarkdown(bulletMatch[1]);
      const lineTopics  = extractTopics(cleanText);

      for (const topic of lineTopics) {
        // One occurrence per journal day
        if (seenThisDay.has(topic)) continue;
        seenThisDay.add(topic);

        if (!topicMap.has(topic)) {
          topicMap.set(topic, { days: new Set(), excerpts: [] });
        }
        const entry = topicMap.get(topic);
        entry.days.add(journalDate);

        // ── 4. Store excerpt (up to 3 total per topic, across all days) ────
        if (entry.excerpts.length < 3) {
          entry.excerpts.push(cleanText.slice(0, 200));
        }
      }
    }
  }

  // ── 5. Filter, sort, cap ────────────────────────────────────────────────

  const filtered = [];
  for (const [topic, { days, excerpts }] of topicMap.entries()) {
    if (days.size >= minOccurrences) {
      filtered.push({ topic, days, excerpts });
    }
  }

  // Sort by occurrence count descending, then topic alphabetically for stability
  filtered.sort((a, b) => {
    const diff = b.days.size - a.days.size;
    return diff !== 0 ? diff : a.topic.localeCompare(b.topic);
  });

  const topCandidates = filtered.slice(0, limit);

  // ── 6. Build return value ───────────────────────────────────────────────

  const candidates = topCandidates.map(({ topic, days, excerpts }) => {
    const sortedDates = [...days].sort();                 // chronological
    const pascal      = toPascalCase(topic);
    return {
      topic,
      occurrences:   days.size,
      dates:         sortedDates,
      excerpts,
      suggestedPath: `/Semantic/${pascal}`,
    };
  });

  return {
    daysScanned:       since,
    journalPagesFound: docs.length,
    candidates,
  };
}

module.exports = { consolidateJournal };
