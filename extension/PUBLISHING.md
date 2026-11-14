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

**2. Register this workflow as a trusted publisher on BOTH registries.**
No tokens. Each registry mints a short-lived one at publish time from the
workflow's OIDC identity, so there is nothing to leak, rotate or forget --
the same mechanism the PyPI job already uses.

- VS Code Marketplace: <https://marketplace.visualstudio.com/manage>, under
  the publisher's settings.
- Open VSX: <https://open-vsx.org/user-settings/trusted-publishers>.

Both pin three things: the repository (`semlayer-dev/semlayer`), the
**workflow file name** (`release.yml`) and the environment
(`vscode-marketplace`). Renaming the workflow file or the environment breaks
publishing, and nothing in this repository can warn you -- the refusal comes
from the registry.

A PAT still works as a fallback on either side (`vsce publish --pat`,
`ovsx publish --pat`), and `--pat` takes precedence over trusted publishing
if both are present. Prefer not to: a token in a repository secret is a
standing liability for a step that runs a few times a year.

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

## What the first publish cost (2026-11-13, 0.1.0)

Four things stood between the tag and the marketplace. **None of them was the
code**, every one failed in a way that did not name its cause, and the next
release should cost none of them.

**1. The environment gate had never heard of `ext-v*`.** The
`vscode-marketplace` environment allowed `branch: main` and `tag: v*`.
`ext-v0.1.0` matches neither, so the job died in two seconds -- *"Tag
'ext-v0.1.0' is not allowed to deploy to vscode-marketplace due to
environment protection rules"* -- before running a single step. Fixed by
adding a deployment rule of type **tag** for `ext-v*` in Settings →
Environments. The `tag: v*` entry there is vestigial: the `vscode` job only
ever runs on `ext-v*`, and engine releases deploy through the `pypi`
environment, which has no policies at all. Leave it; removing it buys
nothing.

That environment also requires a **reviewer**, which is correct and should
stay. A marketplace version is immutable; a human looking once before it
goes is cheap insurance. `pypi` conspicuously lacks this.

**2. `--azure-credential` is the Azure Pipelines route, not ours.** It wants
a Microsoft Entra service principal. On a personal-account publisher it fails
at publish time with *"corporate credentials required"* -- after the
credential check has already passed, so the error arrives nowhere near its
cause. The GitHub Actions route is `--oidc`.

**3. `@vscode/vsce` has to be 4.x.** `--oidc` does not exist in 3.x, and the
run says exactly `error: unknown option '--oidc'`. Both publish CLIs are
devDependencies now, so their versions come from the lockfile rather than
from whatever npm served that morning -- `ovsx` was not a dependency at all
and had been resolving to latest on every run.

**4. Open VSX trusted publishing was not registered.** Its error is the
clearest of the four: *"No trusted publisher matches the presented token."*
0.1.0 went out with a scoped token instead -- **Publishing only**, namespace
`semlayer`, no extension restriction -- and `npx ovsx publish <vsix> -p
<token>` worked first time. **Register the trusted publisher before the next
tag** at <https://open-vsx.org/user-settings/trusted-publishers>; both
registries pin the repo, the workflow FILE NAME and the environment
(`vscode-marketplace`, shared by both steps because they run in one job).

### Four facts worth not relearning

- **A release workflow reads its files from the TAG.** Fixing `main` does
  nothing for a re-run. Delete the release *and* the tag
  (`gh release delete <tag> --cleanup-tag`) and recreate it at the new head.
- **A failed publish consumes nothing.** Only success is irreversible: a
  marketplace version can never be replaced, only superseded. So failing is
  cheap and succeeding-with-a-mistake is not.
- **The marketplace credential lives 15 minutes and each GitHub OIDC token
  can be exchanged once.** Never retry the step in place; re-run the job,
  which mints a new one.
- **"Under review" on the website is the publisher DOMAIN check**, not the
  extension. It gates the blue verified badge and nothing else. The flag that
  gates installs is on the extension, and it reads `validated, public`:

      curl -s -X POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery \
        -H 'Content-Type: application/json' \
        -H 'Accept: application/json;api-version=7.2-preview.1' \
        -d '{"filters":[{"criteria":[{"filterType":7,"value":"semlayer.semlayer"}]}],"flags":914}'

  Open VSX answers the same question at
  <https://open-vsx.org/api/semlayer/semlayer>. Its listing lags the CLI's
  success line by about fifteen seconds; the marketplace item page lags by a
  few minutes and 404s until it catches up. Check the API, not the page.

### The next release, in order

1. Bump `version` in `extension/package.json` and add a `CHANGELOG.md` entry.
2. `npm test && npm run gallery` -- the gallery regenerates eight of the ten
   screenshots and deletes any whose view no longer exists.
3. Merge that to `main`. The README text is baked into the published version;
   the images are URLs and can be replaced afterwards.
4. `gh release create ext-v<version> --prerelease --target <full sha>` -- a
   short sha is rejected with the unhelpful `Release.target_commitish is
   invalid`.
5. Approve the deployment when GitHub asks.
6. Verify from the two APIs above, not from the web pages.

## Still open

- **Open VSX trusted publishing.** 0.1.0 went out with a token because the
  registration was missing. Register it and the next release is secretless on
  both registries.
- **Publisher domain verification** for `semlayer.dev` on the VS Code
  Marketplace -- `isDomainVerified: false`, and it CANNOT be applied for
  until **mid-May 2027**. Microsoft requires the publisher to have had an
  extension live for six months, and the domain registration to be six
  months old, before the Verify button does anything. It is the blue check
  and gates nothing: not installs, not search, not the listing.

  When eligible: publisher page → **Details** tab → **Verified domain** →
  enter the domain → **Save** (Verify stays disabled until you save, which
  looks like a broken button) → **Verify** → a dialog gives the TXT record →
  add it → Verify again. A human then reviews within five business days.

  The domain must not be a subdomain, must serve HTTPS, and must return 200
  to a HEAD request. `semlayer.dev` returns 200 today.

  **Namecheap's Host field is relative**: pasting `semlayer.dev` yields
  `semlayer.dev.semlayer.dev`. Use `@` for the apex and confirm with
  `dns.google` before clicking Verify -- the same trap that cost time on the
  Open VSX namespace verification, which did eventually come through.
- **A `semlayer.dev/vscode` page** to link to from the README.

Never shoot the design mock in `beta/ux/` for a screenshot: it shows surfaces
this version does not implement (the agent chat panel, review as an editor
tab). Eight of the ten images are generated by `npm run gallery`; the two
window captures need a real VS Code window and are listed as `CAPTURED` in
`scripts/gallery.mjs`.
