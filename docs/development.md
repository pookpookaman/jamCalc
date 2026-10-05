# Development

Building jamCalc, testing it, and making a release. For using it, see
[Getting started](getting-started.md).

## Running it from source

Needs Node 22.12 or later.

```bash
npm install
npm run dev          # the web version, on http://localhost:5173
npm run desktop      # the desktop app, built from the current code
npm run desktop:dev  # the desktop app on the dev server, so edits reload live
```

`npm install` finishes by checking that Electron's own program was fetched,
and fetches it if not (`scripts/ensure-electron.mjs`): its download step has
more than once been skipped without a word.

**Developer mode** shows region ids, recompute counts and the text
projection: **Ctrl+Shift+D**, or `?dev=1` on the web address.

**Editing the engine while the dev server runs?** Restart `npm run dev`. The
engine is read straight from source outside the studio's own folder, and a
running server has been seen serving a stale copy of it — which looks exactly
like a bug in your new code.

## Tests

```bash
npm test             # engine, CLI, desktop file handling, extracted UI logic,
                     # the version check and the pinned example results
npm run test:ui      # the worksheet driven in a real browser (e2e/)
npm run typecheck    # every package, the browser tests included
```

`test:ui` uses the Edge that ships with Windows and starts its own server on
port 5180, so one already running for editing is left alone. Set
`PW_BROWSER=chromium` (after `npx playwright install chromium`) to use
Playwright's own browser, as CI will.

Add a browser test for any bug that was about a key, a click, a drag or focus:
those are the ones the unit tests cannot see. Every browser test fails if the
page throws or shows the crash screen, whatever it was checking.

**Reference sheets are a test.** The maintainer keeps a set of real
calculation sheets in `examples/`, with every result pinned in
`test/example-results.json`. Both are private, so in a copy without them
`test/results.test.ts` is skipped. Where they exist, a change that moves any
result fails until it is declared — see [Results that change](#results-that-change).

## Building

```bash
npm run build        # the engine and the CLI, to dist/
npm run build:web    # the web version, a static site in apps/studio/dist/
npm run dist         # the Windows installer and portable app, in apps/desktop/release/
```

The web build uses relative paths, so it can be served from any static host,
including from a subfolder, and carries `LICENSE.txt` and `THIRD-PARTY.md`
beside the page. The installer is unsigned for now.

## Automated checks and the website

[.github/workflows/checks.yml](../.github/workflows/checks.yml) runs on every
push and pull request: typecheck, unit tests, and both builds. A push to
`main` also publishes the web build to GitHub Pages — turn that on once, under
the repository's **Settings → Pages → Source: GitHub Actions**.

Two checks run only on your machine: the browser tests, which need Edge, and
the pinned results of the reference sheets, which are private. Run `npm test`
and `npm run test:ui` before every release.

## Making a release

Versions follow [ADR-0016](decisions/0016-versions.md): one number for the
whole product, kept in the root `package.json`.

1. In [CHANGELOG.md](../CHANGELOG.md), turn **Unreleased** into the new
   version's section, and start a fresh Unreleased above it.
2. Set the version everywhere at once:

   ```bash
   npm run release:version -- 0.2.0
   ```

   This writes every package and the lock file. `npm test` fails if any
   package disagrees, or the version has no changelog section.
3. Refresh the licence notices with `npm run notices` (it rewrites
   [THIRD-PARTY.md](../THIRD-PARTY.md); commit any change), then build and
   check: `npm test`, `npm run test:ui`, `npm run dist`.
   Help → Documentation appears once `homepage` in `apps/desktop/package.json`
   holds the project's public address.
4. Tag it `v0.2.0` and publish the installers from that tag.

### Results that change

A change that alters any computed value on an existing sheet — a bug fix
included — is declared under **Results that change** in the Unreleased
section of the changelog, saying which values move and why. Then:

```bash
npm run results:update
```

records the new values (it needs the reference sheets). It refuses while
nothing is declared. Review the diff
of `test/example-results.json` before committing: it is the list of every
number that moved.

## How the code is laid out

```
packages/engine/    The calculation engine and the document format. Pure
                    TypeScript: no browser, no file system, no framework.
packages/cli/       `calc`, the document operations from a terminal.
apps/studio/        The worksheet itself (React), for the browser and the desktop.
apps/desktop/       The Windows app (Electron): windows, menus, files, printing.
e2e/                Browser tests.
test/               Tests across the whole product: versions, pinned results.
docs/decisions/     Why each foundational choice was made. Read before changing one.
```

[Architecture](architecture.md) goes deeper: where things live and the rules
that hold across them.

## Ground rules

1. `packages/engine` imports nothing from the browser or Node. It is portable
   by construction.
2. Unit conversion constants are exact definitions, never typed decimals.
3. Every syntax-tree `switch` gets an exhaustiveness check. TypeScript does not
   give you one for free.
4. **Render is pure.** No changing shared state while drawing; React may call a
   component more than once per change, and it will.
5. Anything that could show a wrong number as if it were right gets a visible
   marker, not a comment: out-of-date values, errors, regions written by a
   script. People seal and submit what this prints.
6. A foundational decision gets a record in `docs/decisions` before the code
   that assumes it.
7. A result that changes is declared in the changelog — and the pinned example
   results make sure of it.

## Further reading

| | |
|---|---|
| [Architecture](architecture.md) | Where things live, and the rules that hold |
| [The document API](api.md) | The operations, and the `calc` command |
