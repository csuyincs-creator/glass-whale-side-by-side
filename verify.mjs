/**
 * Verification for the side-by-side comparison page.
 *
 * The whole point of this project is that dragging one panel moves the other,
 * so the checks operate on the live camera state of both scenes — not on
 * screenshots. Every check reads the actual camera position out of each child
 * page and compares it against what the shared state says it should be.
 *
 * Run: node verify.mjs
 */
import puppeteer from 'puppeteer-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Locate a Chrome binary without hard-coding anyone's home directory.
 * Set CHROME_PATH to override.
 */
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    process.platform === 'win32'
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    join(homedir(), 'AppData/Local/ms-playwright'),
  ];
  if (existsSync(candidates[0])) return candidates[0];
  // Playwright keeps its browsers in a versioned subdirectory; take the newest
  // one that actually contains a chrome binary.
  const pwRoot = candidates[1];
  if (existsSync(pwRoot)) {
    for (const dir of readdirSync(pwRoot).sort().reverse()) {
      for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const p = join(pwRoot, dir, exe);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

const CHROME = findChrome();
if (!CHROME) {
  console.error('No Chrome found. Set CHROME_PATH to your chrome executable.');
  process.exit(1);
}

const URL = process.env.APP_URL || 'http://127.0.0.1:5173/host/index.html';

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: [
    '--window-size=1600,900',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-lcd-text',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`[page] ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    // A missing favicon is noise from the headless shell, not a page fault.
    if (m.type() === 'error' && !/favicon/i.test(t) && !/404 \(File not found\)/.test(t)) {
      errors.push(`[console] ${t}`);
    }
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });

  // Wait until the host has both child handles.
  await page.waitForFunction(
    'window.__split && document.querySelectorAll("iframe").length === 2',
    { timeout: 60000, polling: 200 }
  );
  // Give the children time to run their first frames under SwiftShader.
  await new Promise((r) => setTimeout(r, 9000));

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  // ---- helpers that read each child's real camera ---------------------
  const readSides = () => page.evaluate(() => {
    const out = {};
    for (const [side, sel] of [['L', '#frameL'], ['R', '#frameR']]) {
      const w = document.querySelector(sel).contentWindow;
      const v = w.__view;
      if (!v) { out[side] = { ok: false }; continue; }
      // Measure distance to the look-at point, not to the world origin: the left
      // scene targets (0,-0.2,0), so |position| would be a few tenths off.
      const cam = v.camera || w.__scene?.camera;
      const p = cam ? cam.position : null;
      const t = side === 'L' ? { x: 0, y: -0.2, z: 0 } : { x: 0, y: 0.03, z: 0 };
      const d = p ? Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) : null;
      out[side] = {
        ok: true,
        side: v.side,
        fov: v.fov,
        halfDiag: v.halfDiag,
        dist: d,
        k: d != null ? d / (v.halfDiag * (Math.tan(27 * Math.PI / 360) / Math.tan(v.fov * Math.PI / 360))) : null,
      };
    }
    return out;
  });

  let sides = await readSides();
  check('both children expose __view',
    sides.L.ok && sides.R.ok,
    `L=${sides.L.ok} R=${sides.R.ok}`);

  if (sides.L.ok && sides.R.ok) {
    check('left reports deepseek geometry',
      Math.abs(sides.L.halfDiag - Math.sqrt(3) * 5) < 1e-6,
      `halfDiag=${sides.L.halfDiag.toFixed(3)}`);
    check('right reports cloud-whale geometry',
      Math.abs(sides.R.halfDiag - Math.sqrt(3) * 0.745) < 1e-6,
      `halfDiag=${sides.R.halfDiag.toFixed(4)}`);

    // Equal framing: both must land on the same normalised k.
    const dk = Math.abs(sides.L.k - sides.R.k);
    check('initial framing is equal on both panels (k matches)', dk < 0.02,
      `kL=${sides.L.k.toFixed(3)} kR=${sides.R.k.toFixed(3)} delta=${dk.toFixed(4)}`);
  }

  // ---- drag on the LEFT half moves BOTH -------------------------------
  const before = await page.evaluate(() => ({ ...window.__split.view }));

  await page.mouse.move(400, 450);      // left panel
  await page.mouse.down();
  await page.mouse.move(620, 500, { steps: 14 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 900));

  const afterDrag = await page.evaluate(() => ({ ...window.__split.view }));
  check('drag on left panel changes yaw',
    Math.abs(afterDrag.yaw - before.yaw) > 0.1,
    `yaw ${before.yaw.toFixed(2)} -> ${afterDrag.yaw.toFixed(2)}`);

  const afterDragSides = await readSides();
  const dkDrag = Math.abs(afterDragSides.L.k - afterDragSides.R.k);
  check('after drag both panels still share framing', dkDrag < 0.02,
    `kL=${afterDragSides.L.k.toFixed(3)} kR=${afterDragSides.R.k.toFixed(3)}`);

  const yawL = await page.evaluate(() => window.__split.view.yaw);
  const camYawL = await page.evaluate(() => {
    const p = document.querySelector('#frameL').contentWindow.__scene?.camera?.position;
    return p ? Math.atan2(p.x, p.z) : null;
  });
  const camYawR = await page.evaluate(() => {
    const w = document.querySelector('#frameR').contentWindow;
    // cloud-whale keeps the camera in __scene
    const p = w.__scene?.camera?.position;
    return p ? Math.atan2(p.x, p.z) : null;
  });
  if (camYawL != null && camYawR != null) {
    // Both children use sin(yaw) on x and cos(yaw) on z, so atan2(x,z) == yaw.
    const eL = Math.abs(((camYawL - yawL + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const eR = Math.abs(((camYawR - yawL + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    check('both cameras sit at the shared yaw', Math.max(eL, eR) < 0.03,
      `errL=${eL.toFixed(3)} errR=${eR.toFixed(3)} target=${yawL.toFixed(3)}`);
  }

  // ---- wheel zoom -----------------------------------------------------
  const kBefore = await page.evaluate(() => window.__split.view.k);
  await page.mouse.move(400, 450);
  await page.mouse.wheel({ deltaY: -600 });
  await new Promise((r) => setTimeout(r, 700));
  const kAfter = await page.evaluate(() => window.__split.view.k);
  check('wheel zooms in', kAfter < kBefore - 0.05,
    `k ${kBefore.toFixed(2)} -> ${kAfter.toFixed(2)}`);

  const zoomSides = await readSides();
  check('zoom keeps both panels equal',
    Math.abs(zoomSides.L.k - zoomSides.R.k) < 0.02,
    `kL=${zoomSides.L.k.toFixed(3)} kR=${zoomSides.R.k.toFixed(3)}`);

  // ---- zoom clamps ----------------------------------------------------
  await page.evaluate(() => { window.__split.view.k = 0.2; window.__split.push(); });
  await page.mouse.move(400, 450);
  await page.mouse.wheel({ deltaY: -9000 });
  await new Promise((r) => setTimeout(r, 500));
  const kMin = await page.evaluate(() => window.__split.view.k);
  check('zoom clamps at the near limit', kMin >= 0.849,
    `k=${kMin.toFixed(3)} (min 0.85)`);

  await page.mouse.wheel({ deltaY: 20000 });
  await new Promise((r) => setTimeout(r, 500));
  const kMax = await page.evaluate(() => window.__split.view.k);
  check('zoom clamps at the far limit', kMax <= 9.601,
    `k=${kMax.toFixed(3)} (max 9.60)`);

  // ---- look up from below ---------------------------------------------
  await page.mouse.move(400, 450);
  await page.mouse.down();
  await page.mouse.move(400, 100, { steps: 20 });   // drag up = pitch down
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 700));
  const pitchNow = await page.evaluate(() => window.__split.view.pitch);
  check('pitch can go below the horizon', pitchNow < 0.0,
    `pitch=${pitchNow.toFixed(3)} rad (${(pitchNow * 180 / Math.PI).toFixed(1)}°)`);

  const belowSides = await readSides();
  check('both panels agree when looking up from below',
    Math.abs(belowSides.L.k - belowSides.R.k) < 0.02);

  // ---- right panel is not interactive on its own ----------------------
  const beforeSolo = await page.evaluate(() => ({ ...window.__split.view }));
  await page.mouse.move(1200, 450);     // right panel
  await page.mouse.down();
  await page.mouse.move(1000, 400, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 700));
  const afterSolo = await page.evaluate(() => ({ ...window.__split.view }));
  // The host captures pointer events for the whole stage, so dragging on the
  // right half must move the same shared state.
  check('dragging on the right half also moves the shared view',
    Math.abs(afterSolo.yaw - beforeSolo.yaw) > 0.05,
    `yaw ${beforeSolo.yaw.toFixed(2)} -> ${afterSolo.yaw.toFixed(2)}`);

  // ---- solo mode ------------------------------------------------------
  await page.keyboard.press('1');
  await new Promise((r) => setTimeout(r, 400));
  const solo = await page.evaluate(() => {
    const r = document.querySelector('#paneR');
    return getComputedStyle(r).display;
  });
  check('key 1 hides the right panel', solo === 'none', `display=${solo}`);
  await page.keyboard.press('0');

  // ---- auto orbit resumes --------------------------------------------
  const yawA = await page.evaluate(() => window.__split.view.yaw);
  await new Promise((r) => setTimeout(r, 6500));
  const yawB = await page.evaluate(() => window.__split.view.yaw);
  check('auto orbit resumes after idle', Math.abs(yawB - yawA) > 0.02,
    `yaw ${yawA.toFixed(3)} -> ${yawB.toFixed(3)}`);

  check('still no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  await page.screenshot({ path: 'shots/split-verify.png' });
  console.log('\nscreenshot: shots/split-verify.png');
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
