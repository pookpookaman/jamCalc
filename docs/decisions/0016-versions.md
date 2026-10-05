# ADR-0016 — One product version, and results that change are declared

**Status:** Accepted and built (2026-09-30). The file format went to 2 with
headers and footers ([headers.md](../headers.md)).

**Where it lives:** `npm run release:version -- <x.y.z>` (`scripts/set-version.mjs`)
sets every package; `test/versions.test.ts` fails if they disagree or the
version has no changelog entry. `test/results.test.ts` pins the example
sheets' results in `test/example-results.json`; `npm run results:update`
(`scripts/update-results.mjs`) records new ones only when CHANGELOG.md's
Unreleased section declares them. `savedWith` is written by every save, from
the app and from `calc`; dirtiness ignores it, so a save never reads as a
change. A sheet from a newer version opens with a notice saying so, and one in
a newer *format* is refused with a message naming the version that saved it.
The version shows on the home screen, in Help → About on desktop, and from
`calc --version`.

## Decision

jamCalc has **one version number** for everything it ships — the desktop app,
the web build, the `calc` command and the engine — written `MAJOR.MINOR.PATCH`.
The document format keeps **its own number**, `schemaVersion`, which changes
only when the file's structure does.

Any release that changes a computed value on an existing sheet says so, under
**Results that change** in the changelog, whatever else the release is. A test
enforces it.

## What a bump means

Read as a calculation tool, not as a library:

| Bump | Example | When |
|---|---|---|
| patch | 0.1.**1** | bug fixes; existing sheets compute the same |
| minor | 0.**2**.0 | new features, units or functions; existing sheets open and compute the same |
| major | **1**.0.0 | existing sheets compute differently, or need changing to open |

Before 1.0 a minor release may still break things, as is usual for a preview.
A bug fix that corrects a wrong result is still a patch — and still goes under
Results that change.

## Why one number

"0.4.2 gave me this" should name exactly the engine that computed it. With a
number per package, a report from the desktop app would need a table to find
which engine was inside. If the engine is ever published as a library on its
own, it can take its own number then; nothing here prevents it.

The number is kept in one place, the root `package.json`, and one command
writes it everywhere else, so no two parts can disagree.

## Why the file format is separate

A file's structure and the app's features change for different reasons and at
different rates. Most releases change no file at all, and a format that bumped
with every release would make every old file look outdated. `schemaVersion`
moves only with the structure. Older files are migrated forward on open
(`document/migrate.ts`); a file from a newer format is refused with a message
naming the version it needs, never opened half-understood.

## Why results that change are enforced

An engineer who has submitted a sheet needs to know if the same sheet would
now come out differently. That is true of a bug fix as much as a feature — more
so, since a corrected number means the old one was wrong. The version number
cannot carry this: a patch can change a result, and a major release may change
none.

A convention would be forgotten on exactly the release where it mattered, so
the results of the example sheets are pinned by a test. A change that moves
any of them fails until the pinned values are updated, which happens in the
same change as the changelog entry.

## Where the version is recorded

- **In each saved sheet**, as `savedWith`: the version that last saved it. A
  checker can trace which engine produced a result, and the app can say when a
  sheet was saved by a newer version than itself.
- **On paper, when asked for.** Two header and footer fields, beside `{date}`
  and `{rev}`:
  - `{version}` — the version doing the printing, which is the one that
    computed the numbers on the page;
  - `{savedWith}` — the version that last saved the file.
  
  Neither prints unless the title block uses it.
- **Everywhere else it should be visible:** an About box, the Help menu,
  `calc --version`, the installer file names, and the web build's home screen.

## Numbering

**0.1.0** is the first public preview. **1.0.0** means three things are true:
the five real acceptance sheets reproduce exactly, print layout included; the
installer is signed; and the statement of what is and is not verified exists.

## A release

1. A changelog entry, with Results that change filled in or stated as none.
2. The bump, by the one command.
3. A `vX.Y.Z` tag.
4. The installers, built from that tag and nothing else.
5. A release on the repository, which is also what auto-update will read.
