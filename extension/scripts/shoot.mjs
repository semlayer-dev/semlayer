/**
 * Render every view to HTML and screenshot it, without VS Code.
 *
 * Why this exists: three visual defects on the extension's first day -- buttons
 * that rendered as plain text, a table count of 318, and a paragraph of
 * implementation notes shown as UI copy -- all reached a human because the only
 * way to see a view was to install the extension and look. The views are pure
 * functions, so they can be rendered here instead.
 *
 *   node scripts/shoot.mjs            write HTML only
 *   node scripts/shoot.mjs --png      also screenshot, if a Chrome is findable
 *
 * The VS Code theme variables are injected here because a webview gets them
 * from the host. Values are Dark Modern's.
 */
import { mkdirSync, writeFileSync, existsSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as V from '../out/views.js';
import * as F from '../test/fixtures.mjs';

const OUT = new URL('../out/shots/', import.meta.url).pathname;
const PNG = process.argv.includes('--png');

const THEME = `
  --vscode-font-family: "Segoe WPC","Segoe UI",system-ui,-apple-system,sans-serif;
  --vscode-editor-font-family: Consolas,"Courier New",Menlo,monospace;
  --vscode-foreground:#cccccc;
  --vscode-descriptionForeground:#9d9d9d;
  --vscode-sideBar-background:#181818;
  --vscode-editor-background:#1f1f1f;
  --vscode-panel-border:#2b2b2b;
  --vscode-button-background:#0078d4;
  --vscode-button-foreground:#ffffff;
  --vscode-button-hoverBackground:#026ec1;
  --vscode-button-secondaryBackground:#313131;
  --vscode-button-secondaryForeground:#cccccc;
  --vscode-list-hoverBackground:#2a2d2e;
  --vscode-list-activeSelectionBackground:#04395e;
  --vscode-textLink-foreground:#4daafc;
  --vscode-editorError-foreground:#f14c4c;
  --vscode-editorWarning-foreground:#cca700;
  --vscode-charts-green:#89d185;
  --vscode-input-background:#313131;
  --vscode-input-foreground:#cccccc;
  --vscode-input-border:#3c3c3c;
  --vscode-textCodeBlock-background:#1f1f1f;
`;

/** A webview has `acquireVsCodeApi`; a browser does not, so stub it. */
const standalone = (html, width) => html
  .replace('<head>', `<head><style>:root{${THEME}}
    html,body{width:${width}px}</style>
    <script>window.acquireVsCodeApi=()=>({postMessage(){}});</script>`);

export const VIEWS = [
  ...Object.keys(F.PANEL_STATES).map((name) => (
    { name, width: 380, html: () => V.renderPanel(F.panelState(name)) })),
  // Sidebar width, because that is where step one now lives.
  { name: 'connect', width: 380, html: () => V.renderConnect(F.CONNECT) },
  { name: 'connect-empty', width: 380, html: () => V.renderConnect(F.CONNECT_EMPTY) },
  { name: 'connect-no-demo', width: 380, html: () => V.renderConnect(F.CONNECT_NO_DEMO) },
  // Sidebar width: step two sits where step one did.
  { name: 'scope', width: 380, html: () => V.renderScope(F.SCOPE) },
  { name: 'scope-deterministic', width: 380,
    html: () => V.renderScope({ ...F.SCOPE, settings: { ...F.SETTINGS, noLlm: true } }) },
  { name: 'scope-running', width: 380,
    html: () => V.renderScope({ ...F.SCOPE, running: true }) },
  // The settings, open -- which is how "Rebuild with settings" arrives, and
  // the only way the form itself is ever looked at.
  // Tall, because the whole point of this one is the form below the fold.
  { name: 'scope-settings', width: 380, height: 2200,
    html: () => V.renderScope({ ...F.SCOPE, expanded: true }) },
  { name: 'serve', width: 380, html: () => V.renderServe(F.SERVE) },
  { name: 'serve-none', width: 380, html: () => V.renderServe(F.SERVE_NONE) },
  { name: 'drift', width: 900, html: () => V.renderDrift(F.DRIFT, 'messy_mart.yaml') },
  { name: 'grants-snowflake', width: 820,
    html: () => V.renderGrants('snowflake', F.GRANT_SNOWFLAKE) },
  { name: 'grants-duckdb', width: 820, html: () => V.renderGrants('duckdb', null) },
  { name: 'review', width: 1100,
    html: () => V.renderReview({ ...F.QUEUE, questions: V.sortQuestions(F.QUEUE.questions) }, 0, false) },
  { name: 'review-empty', width: 900, html: () => V.renderReview(F.QUEUE_EMPTY, 0, false) },
];

function chrome() {
  const candidates = [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * A Windows Chrome cannot open `/home/...`: under WSL the two filesystems are
 * not the same namespace, and it silently writes nothing rather than failing.
 * So when the browser is a .exe, the HTML goes somewhere Windows can see and
 * every path handed to it is converted. This cost one silent empty run.
 */
const isWindows = (bin) => bin.endsWith('.exe');
const toWin = (p) => p.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`)
                      .replace(/\//g, '\\');

function main() {
  mkdirSync(OUT, { recursive: true });
  // Drop output from views that no longer exist. `panel-walkthrough.png` and
  // `settings.png` outlived the screens they showed by a week, sitting beside
  // current ones with nothing to tell them apart.
  const current = new Set(VIEWS.flatMap((v) => [`${v.name}.html`, `${v.name}.png`]));
  for (const f of readdirSync(OUT)) {
    if (!current.has(f)) { unlinkSync(`${OUT}${f}`); }
  }
  const bin = PNG ? chrome() : null;
  if (PNG && !bin) { console.log('no Chrome found; writing HTML only'); }

  // Staging directory the browser can actually read.
  const win = bin && isWindows(bin);
  const stage = win ? '/mnt/c/Users/work/AppData/Local/Temp/semlayer-shots/' : OUT;
  if (win) { mkdirSync(stage, { recursive: true }); }

  let shot = 0;
  for (const v of VIEWS) {
    const file = `${OUT}${v.name}.html`;
    const html = standalone(v.html(), v.width);
    writeFileSync(file, html);

    let note = '';
    if (bin) {
      const src = win ? `${stage}${v.name}.html` : file;
      const png = win ? `${stage}${v.name}.png` : `${OUT}${v.name}.png`;
      if (win) { writeFileSync(src, html); }
      try {
        execFileSync(bin, ['--headless', '--disable-gpu', '--hide-scrollbars',
          `--screenshot=${win ? toWin(png) : png}`,
          `--window-size=${v.width},${v.height ?? 900}`,
          '--virtual-time-budget=3000', win ? toWin(src) : src],
          { stdio: 'ignore', timeout: 60_000 });
        if (existsSync(png)) {
          if (win) { copyFileSync(png, `${OUT}${v.name}.png`); }
          shot++; note = ' + png';
        } else {
          note = ' (no png written)';
        }
      } catch { note = ' (screenshot failed)'; }
    }
    console.log(`  ${v.name}${note}`);
  }
  console.log(`\n${VIEWS.length} views, ${shot} screenshots -> ${OUT}`);
}

main();
