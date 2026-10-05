# Headers and footers

**Status:** planned and built 30 Sep 2026 — all four steps below.

Until then each page had a header and a footer with three text slots — left,
centre, right — that took fields like `{title}` and `{page}`, edited in the
side panel's Page tab. This replaced that with a header and footer the user
lays out themselves, on the page.

**Where it lives:** the model, the fields and the migration in
`packages/engine/src/document/bands.ts`; drawing and editing on the page in
`apps/studio/src/Bands.tsx`; the pure editing steps in `bandEdit.ts`; the
palette bar in `BandBar.tsx`; templates in `templates.ts`, and on desktop in
`apps/desktop/src/files.ts`. Tests: `packages/engine/test/bands.test.ts`,
`apps/studio/test/bandEdit.test.ts`, `e2e/headers.e2e.ts`.

## What was decided

| | Decision |
|---|---|
| Layout | **Free.** Empty by default; the user drops in whichever fields they want, anywhere in the header or footer |
| Editing | **On the page.** Double-click the header or footer to edit it in place; the side panel keeps only settings |
| Reuse | **Saved templates.** A layout saved once and applied to any sheet |
| Extras | A **logo**, **checked-by** fields, and a **sheet-number offset** |
| Not needed | A different first page. Every page has the same header and footer; only page numbers change |

## How it works for the user

1. A new sheet has an empty header and footer: a faint dashed outline on
   screen marks where each is, and nothing prints.
2. Double-click the header (or choose **Edit header and footer** from the File
   or Options menu). The sheet's contents dim and the header and footer become
   editable, with a palette of what can go in them.
3. Drag a field from the palette onto the header — Project, Job no., Sheet
   *x* of *y*, By, Checked, and so on. It shows the sheet's value, or a grey
   placeholder ("Project") while it has none.
4. Click a field to fill in its value — typing the project name into the
   Project field sets it for the sheet, so it is right everywhere it appears.
5. Move and resize things the way regions move on the sheet, with the same
   alignment snapping. Add plain text, lines and boxes to build a boxed title
   block if wanted, and a logo.
6. Drag the header's lower edge to make it taller or shorter; the sheet's
   contents move to make room.
7. **Esc** or clicking the sheet goes back to editing the calculation.

## What can go in

**Fields.** Each is placed as its value alone, or with a small caption above
it (PROJECT / Warehouse Addition) — a toggle per field, since boxed title
blocks use captions and one-line headers do not.

| Field | Value comes from |
|---|---|
| Title | the sheet's title |
| Project, Job no., Subject, Client | the title block, typed once per sheet |
| By, Date | who prepared it, and when |
| Checked, Checked date | who checked it, and when — new |
| Rev | revision |
| Sheet *x*, of *y* | page numbers, with the offset below |
| Date printed | the day it was printed or exported |
| Version | the jamCalc version doing the printing ([ADR-0016](decisions/0016-versions.md)) |
| Saved with | the version that last saved the file |
| File name | the file's name, on desktop |

**Text.** Plain text, which may also contain fields — `Sheet {sheet} of
{sheets}` — for anyone who would rather type than drag. Fields in text use the
same names as the palette.

**Lines and boxes,** for rules and boxed title blocks.

**A logo.** A picture, stored in the sheet as pictures on the sheet already
are, so a sheet stays a single file that prints the same anywhere. Large
images are scaled down on the way in: a header logo does not need to be
megabytes.

Every item has the text styles the Format bar already offers: size, bold,
italic, colour, and alignment within its box.

## Sheet numbering

Two settings in the Page panel:

- **First sheet number** — 1 by default. Set 12 and page 1 prints as sheet 12.
- **Total sheets** — blank by default, meaning this sheet's own last number.
  Set 40 for a calc that is sheets 12–18 of a 40-sheet package.

`{page}` and `{pages}` stay this file's own page numbers; `{sheet}` and
`{sheets}` are the numbers with the offset. The palette's "Sheet *x* of *y*"
uses the latter.

## Templates

- **Save as template** stores the layout — positions, text, lines, logo,
  styles — under a name. It does not store this sheet's values (project,
  dates, initials); those belong to the sheet.
- **Apply template** replaces the sheet's header and footer layout and keeps
  its values, so a sheet can change to the company's new title block without
  retyping anything. One undo step.
- **A default template**, optional, applied to every new sheet.
- Where they live: on desktop, one plain file per template in the app's data
  folder, so an office can copy them around; in a browser, in that browser's
  storage, with export and import so they can move.

## Where it lives in the document

The header and footer become lists of placed items, each with a position in
the band, a size and a style. Values live in the sheet's title block, which
gains the new fields. This changes the file's structure, so it is the first
real bump of the format number (`schemaVersion` 1 → 2) under ADR-0016, with a
migration: an existing sheet's left, centre and right slots become three text
items in the same places, so nothing moves and nothing is lost. A newer file
opened by an older build is refused with a message, as ADR-0016 says.

The document operations get the same changes, so the CLI and anything else
using the API can set a header — and a template is simply a header and footer
in a file of its own.

## Order of work

Each step leaves the app working and releasable.

1. **The model and printing.** Items, the new fields and title-block values,
   sheet-number offset, the migration of existing sheets, and drawing them on
   screen and on paper. No editor yet; existing sheets look as they do now.
2. **Editing on the page.** Edit mode, the palette, dropping fields, moving,
   resizing, deleting, editing values in place, text items, lines and boxes,
   and resizing the header itself.
3. **The logo.**
4. **Templates**, including a default for new sheets.

Browser tests for each: drop a field and see its value, fill a value and see
it on every page, move an item and reload, the numbering offset on page 3,
apply a template and keep the values, and an old sheet opening unchanged.

## Settled while building

- **The header sits in the top margin**, the footer in the bottom one. One
  taller than its margin pushes the contents in (`contentMargins`), so a
  header can never be drawn over the calculation.
- **"Date" is as typed**: a calc's date is the engineer's to state. "Date
  printed" is the automatic one. A format-1 `{date}` meant the day of
  printing, so the migration carries it as `{printed}`.
- **An empty field prints nothing**, not its name. While editing it shows its
  name in grey, so there is something to click.
- **A logo is redrawn on the way in**, no larger than 600 × 240, which also
  turns an SVG into plain pixels: nothing that could run is ever stored. A
  band read from a file or the API accepts only embedded `data:image/…`
  pictures, so opening a sheet never fetches anything.
- **Items are checked on the way in** — from a file, the API or a template —
  and anything malformed is dropped rather than failing the sheet.
- **Templates are keyed by name.** On desktop the file name comes from it,
  limited to letters, digits, spaces, `-` and `_`.
- **Version and Saved with.** Version is the desktop package's until the one
  product version of ADR-0016 is built; Saved with is read from the file and
  shows nothing until saving records it.

## Found while building it

- **Replacing a file on Windows** failed intermittently with EPERM while a
  virus scanner held the file just written — the long-unexplained test flake.
  Saving now retries for up to about a second.
- **A dropdown over the page** covered the spot a field was being dragged to;
  the field list opens as a row inside the bar instead.
