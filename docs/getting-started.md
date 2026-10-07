# Getting started

## Opening jamCalc

**Windows:** run the installer, or unzip the portable app and run
`jamCalc.exe`. Double-clicking a `.jc` file opens it in jamCalc.

The 0.1 preview is not code-signed, so the first time it runs Windows may say
it protected your PC from an unrecognised app. Choose **More info**, then
**Run anyway**. If your organisation blocks unsigned programs, ask IT, or use
the portable app where that is allowed.

**In a browser:** open [jamCalc's website](https://pookpookaman.github.io/jamCalc/) in Chrome or Edge. Other browsers
work but may not print at the sheet's own paper size. Nothing is uploaded:
**Open…** reads a file from your computer and **Save** downloads one.

jamCalc always starts on the **home screen**, never on whatever was open last.
From there: **New sheet**, **Open…**, your recent files, and any sheet a
previous session left with unsaved changes — to restore or discard, one at a
time.

## A first sheet

Choose **New sheet**. Click anywhere on the page to put the cursor there (the
small crosshair), press **M** for a math region, and type:

```
w_u := 2.4 klf
```

Press **Enter**. Press **M** again for the next line — it goes below the last
one — and carry on:

```
L := 25 ft
M_u := w_u*L^2/8 = kip*ft
```

The last line shows *M*<sub>u</sub> = 187.5 kip·ft. That is the whole idea:

- `:=` **defines** a name. `=` at the end **shows** its value; a unit after
  the `=` shows it in that unit. Without one, it is shown in the sheet's unit
  for that kind of quantity: kip·ft for a moment, unless the sheet says
  otherwise.
- A unit follows a number directly (`25 ft`, `2.4 klf`, `36 ksi`). There is no
  hidden multiplication anywhere else: `2*L`, not `2L`.
- `_` starts a subscript: `M_u`, `f'_c`, `phi_b`. Greek names (`phi`, `lambda`,
  `Delta`) are drawn as letters.
- Values flow **down the page and left to right**, like reading. Move a
  definition below where it is used and the sheet says so.

Change `L` to `30 ft` and everything below it recalculates.

Press **T** for a text region — headings, notes, the provisions you are
checking. Prose can quote a live value: `the moment is {M_u}` shows the
number, and keeps it up to date.

The [sheet language](language.md) has the rest: functions, `if`, tables,
matrices, plots, solvers, and every error message.

## Working on the page

| | |
|---|---|
| Click blank paper | put the cursor there — where the next region goes |
| **M** / **T** | a new math or text region at the cursor |
| Insert menu | tables (**D**), plots (**P**), page breaks (**B**); drop a picture onto the page to add it |
| Click a region | edit it in place |
| Drag a region | from anywhere on it; a click that does not move never drags |
| Drag on blank paper | select several; **Shift**-click adds to the selection |
| Bottom-right handle | resize: text wraps, math does not |
| **Delete** | remove what is selected |
| **Ctrl+Z** / **Ctrl+Shift+Z** | undo / redo |
| **Esc** | stop editing |
| Click a result | choose the unit it is shown in |
| **F9** | recalculate, in manual mode |

The **Format** bar appears when something is selected: size, bold, italic,
colour and decimal places. A math region has two colours — the equation and
its result.

The **Values** panel on the right lists every name on the sheet with its
value, in the unit it was written in — or, for a computed value, one that
suits its size. Type in its search box to find a name, click a name to jump to
where it is defined, and click a value to choose the unit it is listed in
(kept with the sheet; it changes the list, not the page). **Options** reopens a closed panel, and holds snapping, the grid
and the dark theme (the page itself always stays white, as it prints).

**Calculation** is automatic. On a large sheet, set the toolbar to **Manual
calc**: edits stop recalculating until **F9**, out-of-date values are dimmed
and underlined, and printing them asks first.

**Problems** show on the region at fault, and the status bar counts them —
click it to list them all.

## Pages, headers and printing

Sheets flow onto as many pages as they need; a region is never split across a
page break, and a long table breaks between its rows with its heading
repeated. The **Page** panel sets paper size, orientation, margins and sheet
numbering.

The same panel holds the sheet's own settings, also under **Options → Units,
numbers and text**:

- **Units**: US or SI, and the unit for each kind of quantity (length,
  force, stress, moment and so on). A unit written after an `=` still wins.
- **Numbers**: significant figures or decimal places, and whether numbers are
  written normally, in scientific or in engineering notation.
- **Text**: the size of maths and of text, the font of text, and whether text
  starts bold.

A region's own settings in the Format bar always win over the sheet's.

Headers and footers start empty. Double-click the top or bottom of a page to
lay one out from fields — project, job number, by, checked, *Sheet x of y* —
text, lines, boxes and a logo, and save it as a template for next time. See
[Headers and footers](headers.md).

**Ctrl+P** prints, at the sheet's own paper size and with nothing added by the
printer. On Windows, **File → Export PDF** writes a PDF directly.

## Saving

**Ctrl+S** saves a `.jc` file; on Windows it goes where you choose, and in a
browser it downloads. While a sheet has unsaved changes a copy is kept, and the
home screen offers it if the app closes before you save. A copy is removed the
moment the sheet is saved, or closed on purpose.

A `.jc` file is plain text. It keeps everything — every region, the page
setup, the header and footer — and the version of jamCalc that saved it.

## Several sheets

Each sheet opens in a **tab**. Drag a tab along the bar to reorder it, or onto
the left or right edge of the page area to see two or three sheets side by
side; the button at the end of a tab bar does the same. The toolbar and panels
follow whichever sheet you last clicked in. **Ctrl+W** or a middle-click
closes a tab.

## Keys

| Key | |
|---|---|
| **Ctrl+N** | new sheet (on Windows) |
| **Ctrl+O** | open |
| **Ctrl+S** / **Ctrl+Shift+S** | save / save as (save as on Windows) |
| **Ctrl+P** | print |
| **Ctrl+W** | close tab (on Windows) |
| **Ctrl+Z** / **Ctrl+Shift+Z** | undo / redo |
| **M**, **T**, **D**, **P**, **B** | math, text, table, plot, page break |
| **F9** | recalculate |
| **Esc** | stop editing |

## Next

- [The sheet language](language.md) for everything a math region can say.
- [The command line](api.md#the-calc-command) to check or batch-run sheets
  without opening the app.
