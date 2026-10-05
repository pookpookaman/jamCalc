# ADR-0010 — Electron for the desktop shell, not Tauri

**Status:** Accepted (2026-09-05)
**Implemented in:** nothing yet — this precedes the code that assumes it
**Supersedes:** the original plan's choice of shell ("Tauri 2 for desktop")

## Decision

The desktop shell is **Electron**. Windows first; macOS follows.

## Why the earlier choice was reopened

The original plan chose Tauri 2, and the reasons were good ones: a few MB per
install instead of a hundred, low memory, and a Rust shell that would sit
naturally beside a future Rust engine port (ADR-0001).

None of those reasons engages with the risk the plan ranked high, print
fidelity — and this product's output is a document that gets sealed, stamped
and submitted. That is the risk this project can least afford to be wrong
about, and the shell decision turns out to drive it.

**Tauri renders in the operating system's webview.** WebView2 (Chromium) on
Windows, WKWebView (WebKit) on macOS. Two rendering engines means two
paginations, two sets of font metrics, and two `@page` implementations. A sheet
that fits on two pages on one engineer's machine could reflow to three on a
colleague's, and neither would know until the printed set came back. Chasing
those differences is unbounded work, and some of it is not fixable from
application code at all.

**Electron bundles one Chromium.** Every install prints identically, on every
platform, and identically to the browser prototype the sheets are already
tested against. The print path becomes one thing to verify rather than one per
operating system.

## What it costs

- **Size and memory.** Roughly 100 MB per install against Tauri's few MB, and
  a heavier resident process. For a desktop engineering tool installed once and
  used all day, this is the cheapest thing being traded here.
- **The Rust argument.** Tauri would have put a Rust toolchain in the build,
  which was half an argument for a future engine port. That port is speculative
  (ADR-0001) and does not need the shell's help: the engine is pure TypeScript
  behind an interface, and a port would replace it, not the shell around it.
- **Security posture.** Electron gives the renderer more rope. Context
  isolation on, node integration off, and a preload bridge exposing only named
  operations — the same discipline the API already imposes, applied to IPC.

## What it buys beyond print

- The toolchain stays pure TypeScript, so the build has one language in it.
- The prototype's rendering assumptions carry over exactly. Anything verified
  in the browser build is verified for the desktop build.
- Chromium's `printToPDF` gives a real PDF export path, which the webview story
  did not have on all platforms.

## What would overturn this

A measured print bake-off showing WebView2 and WKWebView producing
byte-comparable pagination on a page holding math, a table and a heading. That
was offered as an option and not taken; if the size cost ever becomes the
binding constraint, this is the experiment that would justify revisiting.
