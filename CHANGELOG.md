# Changelog

Every release of jamCalc, newest first. Versions follow
[ADR-0016](docs/decisions/0016-versions.md): one number for the whole product,
and the file format numbered on its own.

**Results that change** is in every release, even when it says *None*. It lists
any computed value on an existing sheet that this version gives differently
from the last — including a corrected one, since a corrected number means the
old one was wrong. A set of reference sheets has its results pinned by a
test, so a change cannot ship without being written down here.

## Unreleased

### Results that change

- None. Sheet settings change how a result is shown only when a sheet sets
  them; no sheet's numbers change.

### Added

- **Sheet settings** in the Page panel ([ADR-0017](docs/decisions/0017-sheet-settings.md)):
  US or SI units and a unit for each kind of quantity; significant figures or
  decimals, and normal, scientific or engineering notation; the size of maths
  and text, the font of text, and whether text starts bold.
- The toolbar's actions sit on their own row under the sheet's title.
- **Copy, cut and paste regions** with Ctrl+C, Ctrl+X and Ctrl+V, or the Edit
  menu: whole regions, with their look, size and format, pasted at the cursor
  in the same sheet or another. Pasted into an email or a document, a copy
  reads as the regions do on the page.

### Changed

- The text projection and `calc` reports show numbers in the sheet's number
  format, as the page always did.
- The Format bar's **B** shows text as bold when it is drawn bold.

### Fixed

- **Shift**- or **Ctrl**-clicking a region now adds it to the selection. It
  used to add it and take it straight back out, and on a math region it
  opened the editor instead.

## 0.1.0 — first preview

The first release: a preview, honest about being early. Not for sealed
calculations yet.

### Results that change

- None — the first release.

### In this release

- Unit-aware worksheet: math, prose with live values, tables, plots and
  pictures on a printable page; values flow top to bottom, left to right.
- Units throughout, with results shown in a chosen unit; matrices; functions
  and `if`; numeric root finding, integrals and derivatives.
- Automatic or manual recalculation, with out-of-date values marked and
  printing them confirmed first.
- Headers and footers laid out on the page from fields, text, lines, boxes and
  a logo; saved templates; sheet numbering within a larger set.
- Several sheets open at once in tabs and side-by-side panes; a home screen
  that offers unsaved work from the last session.
- A values panel listing every name with its value, in the unit it was
  written in, searchable; click a value to choose the unit it is listed in.
- Colours for equations and results; dark surroundings with a white page.
- Desktop app for Windows (installer and portable) with real files, print and
  PDF.
- The same worksheet as a website, nothing to install: Chrome or Edge,
  sheets opened from and saved to your own computer.
- `calc`, a command-line tool for reading, evaluating and editing sheets.

### File format

- Format 2. Format-1 sheets open unchanged and are saved as format 2; their
  headers and footers are carried across in the same places.
- Every sheet saved records the version that saved it (`savedWith`).
