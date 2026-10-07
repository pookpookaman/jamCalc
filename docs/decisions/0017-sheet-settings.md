# ADR-0017 — Sheet settings: units, numbers and text

**Status:** Accepted (2026-10-07).

**Where it lives:** `units`, `format` and `textStyle` on the sheet
(`packages/engine/src/document/sheet.ts`), set with `configure`
([api.md](../api.md)); the unit tables in `packages/engine/src/units/prefer.ts`;
the **Sheet settings** groups in the app's Page panel.

## Decision

A sheet carries three optional groups of settings that apply to the whole
document. Each is presentation only: none of them changes a computed value,
and a sheet without them reads exactly as before.

1. **Units.** A result that names no unit after its `=` is shown in the
   sheet's unit for its kind of quantity. The sheet picks a **system**, US or
   SI, and may override any quantity: length, area, volume, moment of inertia,
   force, line load, stress, moment, mass, time, flow and power. A unit written
   after the `=` always wins, as it always has.
2. **Numbers.** The sheet's default format gains a **notation**: *auto*
   (exponent form only for very large or very small numbers, as before),
   *normal* (never an exponent), *scientific* (always one), or *engineering*
   (an exponent that is a multiple of 3). Decimals and significant figures,
   which the file already held, are now set here too. A region may still
   override any of them.
3. **Text.** The default size of maths and of text, whether new text starts
   bold, and the font of text, chosen from *sans-serif*, *serif* or
   *monospace*. A region's own style still wins.

## Why

Every sheet was quietly in one office's conventions: results without a unit
in kip, ft and ksi, numbers in six significant figures, text at 13 pt and
bold. An SI office could not use it without writing a unit after every `=`,
and a style guide could not be applied once per sheet instead of once per
region.

## Choices made

- **One unit per kind of quantity, chosen by dimension.** Stress and area
  load share a dimension, so a sheet in ksi shows a floor load in ksi unless
  the line says `= psf`. Telling them apart would mean guessing intent from
  a name, which is how a result comes to be shown in a unit nobody chose.
- **The system is a starting table, not a lock.** Overrides are per quantity,
  so an SI sheet can still show lengths in mm and spans in m by writing
  `= m` on the spans.
- **Three fonts, by family.** A sheet names a family and the reader's machine
  supplies a font in it. A named font would print differently, or not at all,
  on a machine or a browser without it, and a sheet must print the same
  anywhere.
- **Maths keeps its own font.** The equation renderer draws in its own math
  fonts; only its size is a setting.
- **No new file format.** The settings are optional fields. A build from
  before them opens such a sheet with the notice for a sheet from a newer
  version (ADR-0016), and shows it in the default units, numbers and text.
  Saving it from that older build drops the settings, since a field it does
  not read it cannot write. That is the cost of not bumping the format, and
  the reason the notice is shown.

## What it costs

- The values list, plots, prose with live values, the text projection and
  `calc` all format through the same sheet settings, so each had to be given
  them. A new place that shows a value has to be given them too.
- A result's display string now depends on the sheet as well as the region.
  The pinned results of the reference sheets are unaffected, since none of
  them sets units; a sheet that does will pin its own.
