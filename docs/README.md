# Documentation

**Using jamCalc**

| | |
|---|---|
| [Getting started](getting-started.md) | A first sheet, the keys, saving, printing and tabs |
| [The sheet language](language.md) | Everything a region can contain: syntax, units, operators, built-ins, error codes |
| [Headers and footers](headers.md) | Title blocks laid out on the page: fields, templates, sheet numbering |
| [The document API](api.md) | Reading and writing a sheet from code or the `calc` command |
| [Changelog](../CHANGELOG.md) | Every release, and every result that changed |

**Working on jamCalc**

| | |
|---|---|
| [Development](development.md) | Running from source, tests, building, and making a release |
| [Contributing](../CONTRIBUTING.md) | The rules for a change, and how to send one |
| [Security](../SECURITY.md) | Reporting a problem; what a sheet and the desktop app can and cannot do |
| [Architecture](architecture.md) | Where things live, and the invariants that hold them together |
| [Decisions](decisions/) | Why each foundational choice was made |

## Decisions

| | |
|---|---|
| [0001](decisions/0001-typescript-core.md) | TypeScript core, not Rust — and how to keep the port open |
| [0002](decisions/0002-pound-is-force.md) | `lb` is force; mass is `lbm` |
| [0003](decisions/0003-implicit-multiplication.md) | No implicit multiplication; units are a suffix, not a product |
| [0004](decisions/0004-inline-result.md) | A definition may display its own result |
| [0005](decisions/0005-error-messages.md) | Plain message, separate technical detail |
| [0006](decisions/0006-calculation-modes.md) | Manual calculation, and making stale values unmistakable |
| [0007](decisions/0007-functions-and-if.md) | User-defined functions, and `if` as a special form |
| [0008](decisions/0008-matrices.md) | Matrices, vectors and ranges; 1-based indexing |
| [0009](decisions/0009-document-api.md) | The document API, and the CLI over it |
| [0010](decisions/0010-electron-not-tauri.md) | Electron for the desktop shell, on print-fidelity grounds |
| [0011](decisions/0011-gui-through-the-api.md) | The GUI is an API caller; what that needed added |
| [0012](decisions/0012-data-tables.md) | Data tables bind one name per column |
| [0013](decisions/0013-plots.md) | A plot names values; it does not hold them |
| [0014](decisions/0014-mathlive.md) | MathLive edits the notation; the sheet keeps the source |
| [0015](decisions/0015-literal-names.md) | A backtick keeps a word as written |
| [0016](decisions/0016-versions.md) | One product version, and results that change are declared |
| [0017](decisions/0017-sheet-settings.md) | Sheet settings: units, numbers and text |

New decisions get an ADR **before** the code that assumes them. The format is
short: what was decided, what the alternatives were, and what it costs.
