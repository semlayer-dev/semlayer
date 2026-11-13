/**
 * The feature manifest, printed.
 *
 * `npm test` proves the manifest; this prints it, so the question "are we
 * missing screens" has an answer a person can read rather than a count of
 * passing assertions. Gaps are listed last and in full: the point of writing
 * them down is that "we decided not to" and "we forgot" stop looking the same
 * in a month.
 */
import { FEATURES, byKind } from '../test/features.mjs';

const GROUPS = [
  ['connect', 'Connect'],
  ['create', 'Create'],
  ['lint', 'Lint'],
  ['review', 'Review'],
  ['serve', 'Serve'],
  ['day2', 'Day 2'],
  ['meta', 'The extension itself'],
];

const EVIDENCE = {
  contributes: 'declared',
  logic: 'unit test',
  render: 'renders',
  cli: 'live CLI',
};

const built = FEATURES.filter((f) => f.kind !== 'gap');
const gaps = byKind('gap');

console.log(`\n  ${built.length} features, ${gaps.length} known gaps\n`);

for (const [prefix, title] of GROUPS) {
  const mine = built.filter((f) => f.id.startsWith(`${prefix}.`));
  if (!mine.length) { continue; }
  console.log(`  ${title}`);
  for (const f of mine) {
    console.log(`    ${f.what}`.padEnd(68) + `  ${EVIDENCE[f.kind] ?? f.kind}`);
  }
  console.log('');
}

console.log('  Known gaps — designed, deliberately not built\n');
for (const f of gaps) {
  console.log(`    ${f.what}`);
  console.log(`      ${f.why}`);
}
console.log('');
