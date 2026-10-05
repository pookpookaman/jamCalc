# ADR-0002 — `lb` means pound-force; mass is `lbm`

**Status:** Accepted (2026-09-04)
**Implemented in:** `packages/engine/src/units/registry.ts`

## Decision

- `lb` and `lbf` both bind to **force**. `kip` = 1000 lbf.
- Mass is spelled `lbm` or `slug`. There is no spelling of `lb` that means mass.
- `kg` is **mass**; kilogram-force is `kgf`.
- Force is a *derived* dimension (mass·length/time²), not a base dimension.

## Context

The original plan flagged this as one of two unit decisions that are structural —
get it wrong and the evaluator gets rewritten. Every unit library has to pick a
convention, and the pound is the place users get hurt.

Structural engineering in the US writes `lb` meaning force essentially always:
a 50 lb load is a force. Deferring to physics convention (`lb` = mass) would
make the common case wrong and the rare case right.

Keeping the SI basis — with force derived rather than made a base dimension —
is what lets `lbf` and `kg` coexist in one sheet without a gravitational fudge
factor. A force-based basis appears simpler and then fails the first time
someone writes a dynamics or seismic-mass expression.

## Consequences

- `1 lb + 1 lbm` raises `unit_mismatch`. Correct, and the error message must
  say so clearly — `AMBIGUITY_HINTS` in the registry carries the explanation.
- Anyone arriving from a physics or Python (`pint`) background will be
  surprised once. The hint text is the mitigation.
- Conversion constants are the exact 1959 international agreement values:
  `0.0254 m/in` and `0.45359237 kg/lbm`, with `g = 9.80665 m/s²` exact by
  definition. `N_PER_LBF` is derived from those two, never typed as a decimal.

## Related

Temperature has the same shape of trap and is handled the same way: `degC` is
an absolute temperature, `delta_degC` is a temperature *difference*. Affine
units are rejected inside compound unit expressions rather than silently
dropping their offset.
