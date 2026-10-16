'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertNoLinkedSegments(absolutePath, options = {}) {
  const target = path.resolve(absolutePath);
  const parsed = path.parse(target);
  const relative = path.relative(parsed.root, target);
  let current = parsed.root;
  const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    if (!fs.existsSync(current)) {
      if (options.allowMissing) break;
      throw new Error(`The update path does not exist: ${current}`);
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`The update path contains a link or junction: ${current}`);
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`The update path crosses a non-directory: ${current}`);
  }
  return target;
}

function resolveInsideNoLinks(root, relativePath, options = {}) {
  const resolvedRoot = assertNoLinkedSegments(path.resolve(root), { allowMissing: false });
  const parts = Array.isArray(relativePath) ? relativePath : String(relativePath || '').split('/');
  const target = path.resolve(resolvedRoot, ...parts);
  const rootPrefix = `${pathKey(resolvedRoot)}${path.sep}`;
  if (pathKey(target) !== pathKey(resolvedRoot) && !pathKey(target).startsWith(rootPrefix)) {
    throw new Error('The update path escapes its trusted root.');
  }
  assertNoLinkedSegments(target, { allowMissing: options.allowMissing !== false });
  return target;
}

function validateStageRoot(stageRoot, temporaryRoot = os.tmpdir()) {
  const parent = path.resolve(temporaryRoot, 'click-interval-friend-updates');
  const resolved = path.resolve(stageRoot);
  if (pathKey(path.dirname(resolved)) !== pathKey(parent) || !/^release-[A-Za-z0-9_-]+$/.test(path.basename(resolved))) {
    throw new Error('The Click Interval update stage is outside its dedicated temporary directory.');
  }
  assertNoLinkedSegments(parent, { allowMissing: false });
  assertNoLinkedSegments(resolved, { allowMissing: false });
  if (!fs.lstatSync(resolved).isDirectory()) throw new Error('The Click Interval update stage is not a directory.');
  return resolved;
}

module.exports = { assertNoLinkedSegments, resolveInsideNoLinks, validateStageRoot };
