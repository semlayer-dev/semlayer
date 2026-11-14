/**
 * Reading table counts and names out of a layer document without a parser.
 *
 * The first test is the regression: counting `- name:` by indentation
 * reported 318 for the 36-table messy_mart layer, because columns,
 * relationships and metrics all contribute `- name:` entries too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { countTables, layerName, layerWarehouse } from '../out/yaml.js';

const DOC = `spec_version: 0.4.0
name: messy_mart
warehouse: duckdb:messy_mart.duckdb
semantic_layer:
  generated_by:
    engine: 0.7.0b1
  tables:
  - name: ord_hdr
    table_type: fact
    columns:
    - name: ord_id
      sql_type: BIGINT
    - name: tot_amt
      sql_type: DECIMAL
  - name: cust_mstr
    table_type: dimension
    columns:
    - name: cust_id
  relationships:
  - name: ord_hdr_to_cust_mstr
    cardinality: many_to_one
  metrics:
  - name: total_order_revenue
    agg: sum
`;

test('counts tables, not columns', () => {
  // 2 tables, 3 columns, 1 relationship, 1 metric -- seven `- name:` entries.
  assert.equal(DOC.match(/- name:/g).length, 7);
  assert.equal(countTables(DOC), 2);
});

test('stops at the next sibling key', () => {
  // relationships and metrics sit at the same indent as tables and must not
  // be counted; this is the half the indentation heuristic got wrong.
  assert.equal(countTables(DOC + '  hierarchies:\n  - name: x\n'), 2);
});

test('returns null when there is no tables block', () => {
  assert.equal(countTables('name: not-a-layer\nfoo: 1\n'), null);
});

test('an empty tables block counts zero, not null', () => {
  assert.equal(countTables('semantic_layer:\n  tables:\n  other: 1\n'), 0);
});

test('reads the document name', () => {
  assert.equal(layerName(DOC), 'messy_mart');
  assert.equal(layerName('name: "quoted_name"\n'), 'quoted_name');
  assert.equal(layerName("name: 'single'\n"), 'single');
});

test('reads the warehouse the layer was built from', () => {
  // This is what makes step two work in a freshly reloaded window: the
  // in-memory "last source" is empty there, and a reload is how the extension
  // gets installed, so that was the normal case rather than an edge one.
  assert.equal(layerWarehouse(DOC), 'duckdb:messy_mart.duckdb');
  assert.equal(layerWarehouse('semantic_layer:\n  warehouse: "snowflake:prod"\n'),
               'snowflake:prod');
  assert.equal(layerWarehouse('semantic_layer:\n  tables: []\n'), null);
});

test('does not mistake a column named warehouse for the source', () => {
  assert.equal(layerWarehouse(
    'semantic_layer:\n  tables:\n  - name: t\n    columns:\n'
    + '    - name: c\n      warehouse: nope\n'), null);
});

test('does not mistake a table name for the document name', () => {
  // `  - name: ord_hdr` is a sequence item, not a mapping key, so there is
  // no document name here and null is the honest answer.
  assert.equal(layerName('semantic_layer:\n  tables:\n  - name: ord_hdr\n'), null);
});

// The real thing, when it is present: a 36-table layer that the first
// implementation reported as 318.
const REAL = '/home/rdevnath/semlayer-demo/messy_mart.yaml';
test('the real messy_mart layer counts 36', { skip: !existsSync(REAL) }, () => {
  const text = readFileSync(REAL, 'utf8');
  assert.equal(countTables(text), 36);
  assert.equal(layerName(text), 'messy_mart');
});
