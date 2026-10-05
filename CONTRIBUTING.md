# Contributing

Thank you for helping. jamCalc produces calculations that engineers print,
check and submit, so the rules below are mostly about never showing a wrong
number as if it were right.

## Before you start

- **Running it, testing it and building it** are in
  [docs/development.md](docs/development.md).
- **For anything larger than a fix, open an issue first** and say what you
  intend. It saves building something that does not fit.
- **Security problems** go through [SECURITY.md](SECURITY.md), not an issue.

## The rules

1. **A decision gets a record before the code that assumes it.** Anything
   foundational — the language, units, the file format, how the app is built
   — gets a short record in [docs/decisions](docs/decisions): what was
   decided, what else was considered, and what it costs. Read the existing
   ones before changing anything they cover.
2. **A result that changes is declared.** If your change alters any computed
   value on an existing sheet — a bug fix included — say which values move and
   why under **Results that change** in the Unreleased section of
   [CHANGELOG.md](CHANGELOG.md). The maintainer's reference sheets have their
   results pinned and are checked against that entry before each release.
3. **Nothing wrong looks right.** A value that is out of date, in error or
   written by a script carries a visible marker on the sheet, not a comment in
   the code.
4. **The engine stays pure.** `packages/engine` imports nothing from the
   browser or Node.
5. **The file format moves only with a migration.** A change to what a `.jc`
   holds bumps the format number and carries older files forward
   ([ADR-0016](docs/decisions/0016-versions.md)).

## Tests

Test what would hurt to get wrong, where it can actually break: a calculation
the engine gets wrong, a file that is not saved, a key or a click that stops
working. A bug fixed is a bug that gets a test, at the lowest level that can
see it — a unit test for a decision that can be pulled out into a plain
function, a browser test (`e2e/`) for one that only shows in the page.

Before sending a change:

```bash
npm run typecheck
npm test
npm run test:ui
```

## Writing

Code comments, docs and commit messages say *why*, in plain sentences.
Match the code around you. Name no other software product in the docs.

## Licence

Contributions are under the [MIT licence](LICENSE), the same as the project.
