# Publishing the extension

Two marketplaces, one `.vsix`. Cursor reads the Open VSX registry; VS Code
reads Microsoft's. Publishing to one does not publish to the other.

Everything below needs an account, so none of it can be done for you.

## Before the first publish

**1. Claim the publisher ID on both registries.** `semlayer` must be free on
each, and they are separate namespaces.

- VS Code Marketplace: create an Azure DevOps organisation, then a publisher
  at <https://marketplace.visualstudio.com/manage>. The publisher ID has to
  match `"publisher": "semlayer"` in `package.json`.
- Open VSX: sign in at <https://open-vsx.org> with GitHub, agree to the
  publisher agreement, then create the `semlayer` namespace.

**2. Create tokens.**

- Azure DevOps → User settings → Personal access tokens. Scope:
  **Marketplace → Manage**, organisation **All accessible organisations**.
  A token scoped to a single organisation fails with a 401 that does not say
  why.
- Open VSX → profile → Access Tokens.

**3. Store them as repository secrets** — `VSCE_PAT` and `OVSX_PAT` — if you
want the release workflow to publish. Never put either in `.npmrc`, an env
file, or the repo.

## Publishing

The engine and the extension release separately, on separate tags: `v*`
publishes the engine to PyPI and the MCP registry, `ext-v*` publishes this
extension to the marketplaces. They have different version numbers and
different audiences, and a marketplace version cannot be replaced once it is
published, so neither should be able to drag the other out of the door.

```bash
cd extension
npm ci
npm test            # position reconstruction
npm run package     # writes semlayer-<version>.vsix

npx vsce publish --no-dependencies --pat "$VSCE_PAT"
npx ovsx publish semlayer-*.vsix --pat "$OVSX_PAT"
```

`vsce publish` can bump the version for you (`vsce publish minor`). Do not use
it here: the version in `package.json` is what the `.vsix` and the changelog
already say, and having the command rewrite it mid-publish makes the artifact
you tested not the artifact you shipped.

## Checks the registries apply

- **The icon must be a PNG**, at least 128×128. Ours is the 512×512 brand mark.
- **The README is the marketplace page.** Relative image paths do not resolve
  there — any screenshot has to be an absolute `https://` URL, so put images on
  semlayer.dev or raw.githubusercontent.com rather than in the package.
- **`repository` must point at a public repo** or the page shows no source link.
- A `LICENSE.md` in the package becomes the licence tab. Ours is FSL-1.1-ALv2.

## Installing without a marketplace

The `.vsix` works on its own, which is the whole of the beta distribution plan:

```bash
code   --install-extension semlayer-0.1.0.vsix     # VS Code
cursor --install-extension semlayer-0.1.0.vsix     # Cursor
```

CI attaches the `.vsix` to every run as an artifact, so any commit is
installable without a publish.

## Still missing before a first publish

- **Two window captures.** The gallery is in the README now. Eight of its
  images are generated — `npm run gallery` renders every view and copies the
  published subset into `media/screenshots/`, so they cannot go stale while
  the code moves. The other two need a real VS Code window and are listed as
  `CAPTURED` in `scripts/gallery.mjs`: `01-diagnostics.png` (a SQL file with
  squiggles and the Problems panel open — the single most important image on
  the page) and `02-mcp-clients.png` (the client quick pick). Both are from
  2026-11-05 and their sidebar strip shows a panel layout that no longer
  exists. Retake them by walking the extension; the editor half of the
  diagnostics shot is still accurate.
  Never shoot the design mock in `beta/ux/` for this: it shows surfaces this
  version does not implement (the agent chat panel, review as an editor tab).
- **A `semlayer.dev/vscode` page** to link to from the README.
