# ADR-0001 — Core engine in TypeScript, not Rust

**Status:** Accepted (2026-09-04)
**Supersedes:** the original plan's Rust + WASM recommendation

## Decision

The calculation engine is written in TypeScript, shared by the desktop and web
shells without a WASM boundary.

## Context

The original plan recommended a Rust core compiled to both native and WASM.
Rust remains the better language for an AST evaluator in the abstract —
exhaustive matching over ~40 node types, exact rationals from `num-rational`,
explicit numeric widths, a single-binary CLI.

Three things outweighed that here:

1. **No Rust toolchain present, and no existing Rust fluency.** An AST plus a
   dependency graph with back-references and incremental invalidation is the
   canonical borrow-checker fight. Learning Rust on that problem shape, while
   simultaneously designing the language semantics, is two projects.
2. **The MathLive seam.** MathLive is TypeScript. A Rust core means
   MathLive → TS AST → JSON → Rust AST, a mapping maintained in two places
   forever, sitting on the code path touched most often.
3. **Solo-project throughput.** One language, one debugger, one test runner.
   Context-switching cost is what kills part-time projects around month five.

## Consequences

- Rational arithmetic is hand-written (`src/rational.ts`, ~100 lines) rather
  than taken from a crate.
- Exhaustiveness over the AST relies on discriminated unions plus explicit
  `never` checks. **These must be written deliberately** — the compiler will
  not supply them for free. Treat a missing `never` check as a review defect.
- The CLI requires Node, or bundling via Bun/pkg to hand a colleague a binary.
- Performance headroom is lower. Irrelevant at 500 regions; revisit if batch
  API studies or 10k-region sheets become real workloads.

## Reversibility

This is deliberately reversible. The engine is pure — no DOM, no framework,
no I/O — and reachable only through the operation layer ([api.md](../api.md)).
A later port to Rust is a contained rewrite behind an unchanged
interface, done with the language semantics already settled rather than
invented concurrently. Keep it that way: **nothing in `packages/engine` may
import a browser or Node API.**
