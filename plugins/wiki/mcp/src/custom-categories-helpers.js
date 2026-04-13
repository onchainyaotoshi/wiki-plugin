'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const STOPWORDS = new Set([
  'yang','dan','atau','ini','itu','dari','ke','di','dengan','untuk','adalah',
  'tidak','akan','bisa','harus','sudah','kalau','jika','the','and','or',
  'this','that','from','to','in','with','for','a','an','is','are','was',
  'were','be','been','has','have',
]);

function projectSlug(projectPath) {
  if (!projectPath) return 'default';
  return projectPath.split('/').pop().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}

function cacheFile(projectPath) {
  return path.join(os.homedir(), '.claude', `wiki-custom-categories-${projectSlug(projectPath)}.json`);
}

function loadCustomCategories(projectPath) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(projectPath), 'utf8'));
  } catch (_) { return []; }
}

function saveCustomCategory(projectPath, label, keyPhrases) {
  const cats     = loadCustomCategories(projectPath);
  const existing = cats.find(c => c.label === label);
  if (existing) {
    existing.patterns = [...new Set([...existing.patterns, ...keyPhrases])];
  } else {
    cats.push({ label, patterns: keyPhrases });
  }
  try {
    fs.writeFileSync(cacheFile(projectPath), JSON.stringify(cats, null, 2));
  } catch (_) {}
  return cats;
}

function extractKeyPhrases(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w))
    .slice(0, 5);
}

function mergeWithBuiltins(customCats) {
  // Returns array of {cat, label, emoji, patterns} matching CATEGORIES shape
  return customCats.map(c => ({
    cat:      c.label.toLowerCase().replace(/\s+/g, '_'),
    label:    c.label,
    emoji:    '📝',
    patterns: c.patterns.map(p => new RegExp(p, 'i')),
  }));
}

module.exports = { loadCustomCategories, saveCustomCategory, extractKeyPhrases, mergeWithBuiltins };
