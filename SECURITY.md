# Security

## Reporting a problem

Please report a security problem privately, not in a public issue: use
**Report a vulnerability** on this repository's **Security** tab. Say what you
found, how to reproduce it, and which version (Help → About, or
`calc --version`). You will get an answer, and credit if you want it, once a
fix ships.

Only the latest release is supported. jamCalc is in 0.x, and a fix goes into
the next release rather than being backported.

## What a sheet can do

A `.jc` file is **data**: JSON read by `parseSheet`. It contains no scripts,
no macros and nothing that runs, and must never gain any — so opening a sheet
from someone else is reading text, not running their code. Specifically:

- **Nothing executes.** The sheet language computes numbers and units; it has
  no access to files, the network or the machine. A header or footer is a
  fixed list of fields, not an expression.
- **Nothing is fetched.** Pictures and logos are stored inside the sheet. A
  sheet that points at a web address for one is not drawn, so opening a sheet
  never contacts anyone.
- **Everything is checked on the way in.** A malformed region, header item or
  template is dropped rather than trusted, and a sheet from a newer format is
  refused rather than half-read.

## The desktop app

The worksheet runs in a locked-down window: no Node.js in the page, context
isolation and the sandbox on, and a bridge offering named operations only —
open, save, print, recent files, recovery copies, templates. Beyond that:

- **It writes only where you chose.** A sheet is saved only to a file picked
  in a dialog, opened from the command line or the recent list, or restored
  from a copy the app kept. The page cannot name another path and have it
  written.
- **Its own files stay in its folder.** Recovery copies and templates are
  named from fixed characters only, so no name can reach outside the app's
  data folder.
- **Links open in your browser**, never inside the app.
- **No updates or telemetry.** The app does not contact any server.

## The browser version

The website is static files: there is no server behind it, no account and no
upload.

- **Sheets stay on your computer.** Opening reads a file you chose; saving
  downloads one.
- **What it keeps, it keeps in your browser** — unsaved work, templates and
  settings — in storage only this site can read, on that computer.
- **No tracking.** The site loads nothing from anywhere else and sends nothing.

Anything that breaks one of these is a security problem — please report it as
above.
