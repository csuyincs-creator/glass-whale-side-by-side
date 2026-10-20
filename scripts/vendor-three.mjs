/**
 * Copies the parts of three.js the left scene needs into ./vendor.
 *
 * The left scene is a plain ES-module page whose import map points at
 * /vendor/build and /vendor/examples/jsm. Those are 25 MB of build output, so
 * they are not committed — this script regenerates them after `npm install`.
 */
import { cp, mkdir, rm, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules', 'three');
const dst = join(root, 'vendor');

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

if (!(await exists(src))) {
  console.error('three is not installed. Run `npm install` first.');
  process.exit(1);
}

await rm(dst, { recursive: true, force: true });
await mkdir(dst, { recursive: true });

// Only these two subtrees are imported by the left scene.
await cp(join(src, 'build'), join(dst, 'build'), { recursive: true });
await cp(join(src, 'examples'), join(dst, 'examples'), { recursive: true });

// Keep the licence alongside the copied code.
if (await exists(join(src, 'LICENSE'))) {
  await cp(join(src, 'LICENSE'), join(dst, 'LICENSE'));
}

console.log('vendor/ ready (three build + examples)');
