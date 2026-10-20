import * as esbuild from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const WATCH = process.argv.includes('--watch');

async function build() {
  const t0 = Date.now();
  const res = await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    minify: !WATCH,
    target: ['chrome100'],
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  const js = res.outputFiles[0].text;
  await writeFile('bundle.js', js);

  // also produce a fully self-contained single file
  const html = await readFile('index.html', 'utf8');
  const inlined = html.replace('<script src="./bundle.js"></script>', () => `<script>\n${js}\n</script>`);
  await writeFile('cloud-whale.html', inlined);

  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`bundle.js ${kb(js.length)}  cloud-whale.html ${kb(inlined.length)}  (${Date.now() - t0} ms)`);
}

await build();

if (WATCH) {
  const { watch } = await import('node:fs');
  let timer = null;
  watch('src', { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e.message)), 120);
  });
  console.log('watching src/ ...');
}
