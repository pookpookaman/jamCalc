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

- None.

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
