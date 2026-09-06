#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walk(absolute);
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [absolute] : [];
  });
}

function markdownFiles() {
  const files = [];
  const readme = path.join(root, 'README.md');
  if (fs.existsSync(readme)) files.push(readme);

  const docs = path.join(root, 'docs');
  if (fs.existsSync(docs)) files.push(...walk(docs));

  return files;
}

function normalizeDestination(raw) {
  let value = raw.trim();
  if (value.startsWith('<') && value.includes('>')) {
    value = value.slice(1, value.indexOf('>'));
  } else {
    const titleMatch = value.match(/^(.*?)(?:\s+["'(].*)$/);
    if (titleMatch) value = titleMatch[1].trim();
  }

  return value;
}

function isExternal(value) {
  return value.startsWith('#')
    || value.startsWith('//')
    || /^[a-z][a-z0-9+.-]*:/i.test(value);
}

const broken = [];

for (const file of markdownFiles()) {
  const content = fs.readFileSync(file, 'utf8');
  const destinations = [];

  const inline = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(inline)) {
    destinations.push({ raw: match[1], index: match.index ?? 0 });
  }

  const reference = /^\s*\[[^\]]+\]:\s*(\S+)/gm;
  for (const match of content.matchAll(reference)) {
    destinations.push({ raw: match[1], index: match.index ?? 0 });
  }

  for (const destination of destinations) {
    let target = normalizeDestination(destination.raw);
    if (!target || isExternal(target)) continue;

    target = target.split('#', 1)[0].split('?', 1)[0];
    if (!target) continue;

    try {
      target = decodeURIComponent(target);
    } catch {
      // Keep the literal target; existence validation below will fail clearly.
    }

    const resolved = path.resolve(path.dirname(file), target);
    const insideRepository = resolved === root || resolved.startsWith(root + path.sep);
    if (!insideRepository || !fs.existsSync(resolved)) {
      const line = content.slice(0, destination.index).split('\n').length;
      broken.push({
        file: path.relative(root, file).replaceAll(path.sep, '/'),
        line,
        target,
        resolved: path.relative(root, resolved).replaceAll(path.sep, '/'),
        reason: insideRepository ? 'missing' : 'escapes repository',
      });
    }
  }
}

if (broken.length > 0) {
  console.error('Broken relative Markdown links found:');
  for (const item of broken) {
    console.error(`- ${item.file}:${item.line} -> ${item.target} (${item.reason}: ${item.resolved})`);
  }
  process.exit(1);
}

console.log('Relative Markdown links: PASS');
