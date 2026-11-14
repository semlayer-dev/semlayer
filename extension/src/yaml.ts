/**
 * The two facts the sidebar needs from a layer document, read without a YAML
 * parser -- this package ships no runtime dependencies, and pulling one in to
 * render a subtitle would be a poor trade.
 *
 * Both are deliberately conservative: they answer from the document's own
 * shape, and when the shape is not what they expect they return nothing
 * rather than a number that looks authoritative and is wrong.
 */

/**
 * How many tables the document declares.
 *
 * Counting `- name:` by indentation does NOT work, and the first version did
 * exactly that: it matched every `- name:` at two spaces or deeper and
 * reported 318 for a 36-table layer. Both levels are populated --
 *
 *     tables:            <- the block we want
 *     - name: ord_hdr    <- 2 spaces: a table
 *       columns:
 *       - name: tot_amt  <- 4 spaces: a column
 *     relationships:     <- also 2 spaces, also `- name:` entries
 *
 * -- so 99 entries sat at two spaces and 219 at four, and neither number was
 * 36. The block has to be scoped, which is what this does: enter at
 * `tables:`, count its direct sequence items, stop at the next sibling key.
 */
export function countTables(text: string): number | null {
  const lines = text.split('\n');
  let indent: string | null = null;
  let n = 0;

  for (const line of lines) {
    if (indent === null) {
      const m = /^(\s*)tables:\s*$/.exec(line);
      if (m) { indent = m[1]; }
      continue;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) { continue; }
    if (line.startsWith(`${indent}- `)) {
      if (/^\s*-\s+name\s*:/.test(line)) { n++; }
      continue;
    }
    // Any other line at this indent or shallower is the next key: the
    // sequence is over. Deeper lines belong to the table we are inside.
    if (!line.startsWith(indent + ' ')) { break; }
  }
  return indent === null ? null : n;
}

/**
 * The warehouse this document was inferred from.
 *
 * It is written into every layer as `warehouse:`, and reading it back is what
 * lets step two work in a window that has not connected to anything yet. The
 * alternative was a variable held in memory, which meant the Create step did
 * nothing useful after a reload -- the commonest state of all, since a reload
 * is how the extension gets installed.
 *
 * Indent-limited the same way `layerName` is, so a column named `warehouse`
 * deeper in the document cannot be mistaken for it.
 */
export function layerWarehouse(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = /^(\s*)warehouse\s*:\s*(\S.*)$/.exec(line);
    if (m && m[1].length <= 2) {
      return m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}

/** The document's own `name:`, which is the identity other layers reference. */
export function layerName(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = /^(\s*)name\s*:\s*(\S.*)$/.exec(line);
    if (m && m[1].length <= 2) {
      return m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}
