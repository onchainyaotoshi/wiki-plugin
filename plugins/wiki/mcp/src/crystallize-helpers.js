'use strict';

/**
 * crystallize-helpers.js — extract structured digest data from a Claude Code
 * session JSONL file or a plan/brainstorm markdown file.
 *
 * Does NOT summarize. Returns structured data (tool calls, file paths, error
 * messages, key text blocks) for Claude to review and turn into a wiki page.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Sanitize project path to Claude Code's sessions directory name.
 * /home/firman/camis_api_native → -home-firman-camis-api-native
 */
function _sessionsDir(projectPath) {
  const sanitized = projectPath.replace(/[/_]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', sanitized);
}

/** Format a Date (or ms timestamp) as YYYY-MM-DD */
function _isoDate(mtimeMs) {
  return new Date(mtimeMs).toISOString().slice(0, 10);
}

/**
 * Convert a string to a kebab-case slug using the first N words.
 * "Session abc12345" → "session-abc12345" (2 words → "session-abc12345")
 * "My Great Title" → "my-great-title" (3 words)
 */
function _slugFromTitle(title, wordCount = 3) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, wordCount)
    .join('-');
}

/**
 * Extract text from a tool_result content value.
 * content can be: string | Array<{type:'text', text:string}>
 */
function _resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c && c.type === 'text')
      .map(c => c.text || '')
      .join(' ');
  }
  return '';
}

// ── Session (JSONL) extraction ─────────────────────────────────────────────

function _extractFromJsonl(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines   = content.split('\n').filter(l => l.trim());

  const toolCounts   = {};   // name → count
  const filesEdited  = new Set();
  const errors       = [];
  const keyTextBlocks = [];

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch (_) { continue; }

    if (entry.type === 'assistant') {
      for (const c of entry.message?.content ?? []) {
        // Tool-use blocks → track names + file paths
        if (c.type === 'tool_use') {
          toolCounts[c.name] = (toolCounts[c.name] || 0) + 1;
          const inp = c.input || {};
          const filePath_ = inp.file_path || inp.path;
          if (typeof filePath_ === 'string' && filePath_.length > 0) {
            filesEdited.add(filePath_);
          }
        }
        // Text blocks → key text candidates
        if (c.type === 'text' && typeof c.text === 'string' && c.text.length > 100) {
          keyTextBlocks.push(c.text);
        }
      }
    }

    if (entry.type === 'user') {
      // F4: content can be at entry.message.content OR entry.content (two JSONL formats)
      for (const c of entry.message?.content ?? entry.content ?? []) {
        if (c.type === 'tool_result' && c.is_error === true) {
          const msg = _resultText(c.content).trim();
          if (msg && errors.length < 5) {
            errors.push(msg);
          }
        }
      }
    }
  }

  // toolsUsed: sorted by count desc
  const toolsUsed = Object.entries(toolCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // keyTextBlocks: sort by length desc, top 8
  const sortedBlocks = keyTextBlocks
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);

  return {
    toolsUsed,
    filesEdited: Array.from(filesEdited),
    errors,
    keyTextBlocks: sortedBlocks,
  };
}

// ── Plan file extraction ───────────────────────────────────────────────────

function _extractFromPlan(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // title: first # Heading line, or filename stem
  let title = path.basename(filePath, '.md');
  for (const line of content.split('\n')) {
    const m = line.match(/^#\s+(.+)/);
    if (m) { title = m[1].trim(); break; }
  }

  // paragraphs > 50 chars, up to 10
  const keyTextBlocks = content
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 50)
    .slice(0, 10);

  return { title, keyTextBlocks };
}

// ── Template builder ───────────────────────────────────────────────────────

function _buildTemplate({ source, title, date, toolsUsed, filesEdited, errors, keyTextBlocks }) {
  // Tools / Files section
  let toolsFilesSection = '';
  if (source === 'session') {
    const toolLines = (toolsUsed || []).map(t => `- \`${t.name}\` × ${t.count}`);
    const fileLines = (filesEdited || []).map(f => `- ${f}`);
    const combined  = [...toolLines, ...(fileLines.length ? ['', '**Files:**', ...fileLines] : [])];
    toolsFilesSection = combined.length ? combined.join('\n') : '_None recorded_';
  } else {
    toolsFilesSection = '_N/A (plan source)_';
  }

  // Errors section
  const errorsSection = (errors && errors.length)
    ? errors.map((e, i) => `${i + 1}. ${e.slice(0, 300)}`).join('\n')
    : 'None';

  // Raw text blocks as numbered list, truncated to 300 chars each
  const rawBlocksSection = keyTextBlocks.length
    ? keyTextBlocks.map((b, i) => `${i + 1}. ${b.slice(0, 300)}${b.length > 300 ? '…' : ''}`).join('\n\n')
    : '_No text blocks extracted_';

  return `# Digest: ${title}

**Date**: ${date}
**Source**: ${source}

## Key Findings
<!-- Claude: synthesize from keyTextBlocks below -->

## Tools / Files Involved
${toolsFilesSection}

## Errors Encountered
${errorsSection}

## Raw Text Blocks
${rawBlocksSection}

## Lessons Learned
<!-- Claude: fill this in -->
`;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Crystallize a session JSONL or a plan file into a structured digest.
 *
 * @param {{
 *   projectPath?: string,
 *   sessionId?:  string,
 *   planFile?:   string,
 * }} opts
 */
async function crystallizeSession(opts = {}) {
  const projectPath = opts.projectPath || process.env.PWD;
  if (!projectPath) throw new Error('projectPath required (or set PWD)');

  const { sessionId, planFile } = opts;
  if (!sessionId && !planFile) {
    throw new Error('At least one of sessionId or planFile must be provided');
  }

  // ── Session branch ─────────────────────────────────────────────────────
  if (sessionId) {
    const sessDir = _sessionsDir(projectPath);
    if (!fs.existsSync(sessDir)) {
      throw new Error(`Sessions directory not found: ${sessDir}`);
    }

    const allFiles = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));
    const match_   = allFiles.find(f => f.startsWith(sessionId));
    if (!match_) {
      throw new Error(`No JSONL file found matching prefix "${sessionId}" in ${sessDir}`);
    }

    const fullPath = path.join(sessDir, match_);
    const mtime    = fs.statSync(fullPath).mtimeMs;
    const date     = _isoDate(mtime);
    const title    = `Session ${sessionId}`;

    const extracted = _extractFromJsonl(fullPath);

    const suggestedPath = `/Digests/${date}-${_slugFromTitle(title, 3)}`;
    const wikiTemplate  = _buildTemplate({
      source: 'session',
      title,
      date,
      ...extracted,
    });

    return {
      source:      'session',
      sessionId,
      date,
      title,
      toolsUsed:   extracted.toolsUsed,
      filesEdited: extracted.filesEdited,
      errors:      extracted.errors,
      keyTextBlocks: extracted.keyTextBlocks,
      suggestedPath,
      wikiTemplate,
    };
  }

  // ── Plan branch ────────────────────────────────────────────────────────
  const planDirs = [
    path.join(os.homedir(), '.claude', 'plans'),
    path.join(projectPath, 'docs', 'plans'),
    path.join(projectPath, 'docs', 'brainstorms'),
    path.join(projectPath, 'docs', 'solutions'),
  ];

  let foundPath = null;
  for (const dir of planDirs) {
    const candidate = path.join(dir, planFile);
    if (fs.existsSync(candidate)) {
      foundPath = candidate;
      break;
    }
  }

  if (!foundPath) {
    throw new Error(
      `Plan file "${planFile}" not found in: ${planDirs.join(', ')}`
    );
  }

  const mtime    = fs.statSync(foundPath).mtimeMs;
  const date     = _isoDate(mtime);
  const extracted = _extractFromPlan(foundPath);
  const { title, keyTextBlocks } = extracted;

  const suggestedPath = `/Digests/${date}-${_slugFromTitle(title, 3)}`;
  const wikiTemplate  = _buildTemplate({
    source: 'plan',
    title,
    date,
    keyTextBlocks,
    errors: [],
  });

  return {
    source: 'plan',
    planFile,
    date,
    title,
    keyTextBlocks,
    suggestedPath,
    wikiTemplate,
  };
}

module.exports = { crystallizeSession };
