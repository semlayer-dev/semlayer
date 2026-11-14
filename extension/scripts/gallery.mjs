/**
 * The marketplace gallery: a named subset of the rendered views, copied out.
 *
 *   node scripts/gallery.mjs        (after `npm run shoot`)
 *
 * Why a script and not a folder someone drags files into: `media/screenshots/`
 * held a shot of a walkthrough panel that no longer exists and a settings
 * screen that was deleted, beside two real-window captures that were still
 * fine. Nothing said which was which. Now the renderable half is generated,
 * so it is as current as the last `npm run shoot`, and the captured half is
 * listed here by name so it is obvious that it is NOT generated and what it
 * would take to retake it.
 *
 * The numbering is the order the marketplace shows them in, which is the
 * order of the three steps.
 */
import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';

const SHOTS = new URL('../out/shots/', import.meta.url).pathname;
const OUT = new URL('../media/screenshots/', import.meta.url).pathname;

/** view name -> published name, in gallery order. */
export const GALLERY = [
  ['panel-connect', '01-connect'],
  ['scope', '02-create'],
  ['scope-settings', '03-settings'],
  ['serve', '04-query'],
  ['panel-resting', '05-day2'],
  ['review', '06-review'],
  ['drift', '07-drift'],
  ['grants-snowflake', '08-grants'],
];

/**
 * Shots of the whole editor window, which cannot be rendered headlessly: they
 * need a real VS Code with a file open, the Problems panel up and a quick pick
 * on screen. Kept by hand; retaking one means walking the extension.
 */
export const CAPTURED = ['01-diagnostics.png', '02-mcp-clients.png'];

function main() {
  const keep = new Set([...GALLERY.map(([, to]) => `${to}.png`), ...CAPTURED]);
  let copied = 0;

  for (const [view, to] of GALLERY) {
    const src = `${SHOTS}${view}.png`;
    if (!existsSync(src)) {
      console.log(`  MISSING ${view} -- run \`npm run shoot\` first`);
      continue;
    }
    copyFileSync(src, `${OUT}${to}.png`);
    console.log(`  ${to}.png  <- ${view}`);
    copied++;
  }

  // A screenshot of a screen that no longer exists is worse than none: it is
  // the marketplace page claiming a feature that was removed.
  for (const f of readdirSync(OUT)) {
    if (f.endsWith('.png') && !keep.has(f)) {
      unlinkSync(`${OUT}${f}`);
      console.log(`  removed ${f} (no view renders it any more)`);
    }
  }

  console.log(`\n${copied} generated, ${CAPTURED.length} captured by hand`);
}

main();
