'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

/**
 * Hash a file or directory (SHA-256, first 16 hex chars).
 * Same algorithm as docs/wiki/sources.js:hashPath.
 */
function hashPath(absPath) {
  const hash = crypto.createHash('sha256');
  const stat  = fs.statSync(absPath);

  if (stat.isFile()) {
    hash.update(fs.readFileSync(absPath));
  } else if (stat.isDirectory()) {
    const files = fs.readdirSync(absPath, { recursive: true }).sort();
    for (const file of files) {
      const ext = path.extname(file);
      if (['.js', '.md', '.hbs', '.css', '.json'].includes(ext)) {
        const full = path.join(absPath, file);
        if (fs.statSync(full).isFile()) {
          hash.update(file);
          hash.update(fs.readFileSync(full));
        }
      }
    }
  }

  return hash.digest('hex').slice(0, 16);
}

/**
 * Hash an array of paths (combined hash).
 * Returns { hash, resolvedPaths } where hash is 16-char hex.
 */
function hashPaths(filePaths, baseDir) {
  const resolved = filePaths.map(p =>
    path.isAbsolute(p) ? p : path.join(baseDir, p)
  );
  const combined = crypto.createHash('sha256');
  for (const p of resolved) {
    combined.update(hashPath(p));
  }
  return { hash: combined.digest('hex').slice(0, 16), resolvedPaths: resolved };
}

module.exports = { hashPath, hashPaths };
