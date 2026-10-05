/**
 * Dependency graph over regions.
 *
 * The binding rule is positional, not global: a reference resolves to the
 * nearest *preceding* definition in evaluation order. That is what makes
 * redefinition work the way engineers use it —
 *
 *     L := 25 ft        (a trial value)
 *     ... calcs ...
 *     L := 30 ft        (revised; everything below re-runs, nothing above does)
 *
 * A global symbol table would make the second definition retroactively change
 * the first half of the sheet, which is both wrong and alarming.
 */

import type { Expr, Statement } from "../ast.js";
import { assertNever } from "../errors.js";
import { parseStatement } from "../parser.js";
import { BUILTINS } from "../eval.js";

/** `if` is a special form rather than an entry in BUILTINS. */
const isBuiltinCallable = (name: string): boolean =>
  name === "if" || Object.hasOwn(BUILTINS, name);
import type { Region, RegionId } from "./region.js";
import { tableProvides } from "./table.js";
import { plotReads } from "./plot.js";
import { textReads } from "./text.js";
import { evaluationOrder, type OrderOptions } from "./order.js";

/**
 * Names an expression reads, split by how they are used.
 *
 * Kept apart because an unresolved *call* may be a builtin and therefore fine,
 * whereas an unresolved *variable* never is. Lumping them together made every
 * `sqrt(x)` look like a reference to an undefined name.
 */
export interface References {
  readonly reads: Set<string>;
  readonly calls: Set<string>;
}

export function collectReferences(
  node: Expr,
  into: References = { reads: new Set(), calls: new Set() },
): References {
  switch (node.kind) {
    case "number":
      return into;
    case "identifier":
      into.reads.add(node.name);
      return into;
    case "unary":
      return collectReferences(node.operand, into);
    case "binary":
      collectReferences(node.left, into);
      return collectReferences(node.right, into);
    case "call":
      into.calls.add(node.callee);
      for (const a of node.args) collectReferences(a, into);
      return into;
    case "matrix":
      for (const row of node.rows) for (const cell of row) collectReferences(cell, into);
      return into;
    case "index":
      collectReferences(node.target, into);
      for (const i of node.indices) collectReferences(i, into);
      return into;
    default:
      return assertNever(node);
  }
}

/** Parse-level facts about one region's source, independent of its context. */
export interface SourceAnalysis {
  readonly statement?: Statement;
  readonly parseError?: unknown;
  /** Name this region defines, if any. */
  readonly defines?: string;
  /** Names this region reads as values. */
  readonly reads: ReadonlySet<string>;
  /** Names this region calls as functions. */
  readonly calls: ReadonlySet<string>;
  /** Parameter names, which are local to a function body and bind nothing. */
  readonly params: readonly string[];
}

export interface RegionAnalysis extends SourceAnalysis {
  readonly id: RegionId;
  /** Regions this one depends on, resolved positionally. */
  readonly dependsOn: readonly RegionId[];
  /**
   * Name -> the region that provides it. Needed to blame the *right* region
   * when a value is missing: `dependsOn[0]` is not the culprit just because it
   * happens to be first.
   */
  readonly resolved: ReadonlyMap<string, RegionId>;
  /** Names read here that no preceding region defines. */
  readonly unresolved: readonly string[];
  /**
   * Every name this region binds.
   *
   * A math region binds at most one; a table binds one per column. `defines`
   * stays the single-name form the language uses, and this is what the binding
   * pass actually walks.
   */
  readonly provides: readonly string[];
}

export function analyzeSource(source: string): SourceAnalysis {
  if (source.trim() === "") {
    return { reads: new Set(), calls: new Set(), params: [] };
  }

  let statement: Statement | undefined;
  let parseError: unknown;
  try {
    statement = parseStatement(source);
  } catch (e) {
    parseError = e;
  }

  const refs: References = { reads: new Set(), calls: new Set() };
  let defines: string | undefined;
  let params: string[] = [];
  if (statement) {
    if (statement.kind === "definition") {
      defines = statement.name;
      params = (statement.params ?? []).map((p) => p.name);
      collectReferences(statement.value, refs);
    } else {
      collectReferences(statement.expression, refs);
    }
  }

  // A parameter is bound by the function, not by the sheet, so it is not a
  // dependency on anything above. Without this, `f(x) := 2*x` would report `x`
  // as an undefined name.
  for (const p of params) refs.reads.delete(p);

  return {
    ...(statement ? { statement } : {}),
    ...(parseError !== undefined ? { parseError } : {}),
    ...(defines !== undefined ? { defines } : {}),
    reads: refs.reads,
    calls: refs.calls,
    params,
  };
}

export interface Graph {
  /** Evaluation order, ids only. */
  readonly order: readonly RegionId[];
  readonly analyses: ReadonlyMap<RegionId, RegionAnalysis>;
  /** Reverse edges: region -> regions that must recompute when it changes. */
  readonly dependents: ReadonlyMap<RegionId, readonly RegionId[]>;
}

export function buildGraph(
  regions: readonly Region[],
  options: OrderOptions = {},
): Graph {
  const ordered = evaluationOrder(regions, options);
  const analyses = new Map<RegionId, RegionAnalysis>();
  const dependents = new Map<RegionId, RegionId[]>();

  /** Name -> region currently providing it, walking in evaluation order. */
  const binding = new Map<string, RegionId>();

  for (const region of ordered) {
    dependents.set(region.id, dependents.get(region.id) ?? []);
    if (region.kind !== "math") {
      // A table binds a name per column and reads nothing; a plot is the
      // mirror image, reading names and binding none. Both take part in the
      // graph, so a plot recomputes when its data changes and a table's
      // readers recompute when the grid does.
      const provides = region.kind === "table" ? tableProvides(region) : [];
      // A plot reads the names it draws; prose reads the names it quotes.
      const reads =
        region.kind === "plot"
          ? plotReads(region)
          : region.kind === "text"
            ? textReads(region.runs)
            : new Set<string>();

      const dependsOn: RegionId[] = [];
      const resolved = new Map<string, RegionId>();
      const unresolved: string[] = [];
      for (const name of reads) {
        const provider = binding.get(name);
        if (provider === undefined) unresolved.push(name);
        else {
          resolved.set(name, provider);
          if (!dependsOn.includes(provider)) dependsOn.push(provider);
        }
      }

      analyses.set(region.id, {
        id: region.id,
        reads,
        calls: new Set(),
        params: [],
        dependsOn,
        resolved,
        unresolved,
        provides,
      });
      for (const dep of dependsOn) {
        const list = dependents.get(dep);
        if (list) list.push(region.id);
        else dependents.set(dep, [region.id]);
      }
      for (const name of provides) binding.set(name, region.id);
      continue;
    }

    const source = analyzeSource(region.source);
    const { reads, calls, defines } = source;

    const dependsOn: RegionId[] = [];
    const resolved = new Map<string, RegionId>();
    const unresolved: string[] = [];
    for (const name of reads) {
      const provider = binding.get(name);
      if (provider === undefined) {
        unresolved.push(name);
      } else {
        resolved.set(name, provider);
        if (!dependsOn.includes(provider)) dependsOn.push(provider);
      }
    }
    for (const name of calls) {
      const provider = binding.get(name);
      if (provider !== undefined) {
        resolved.set(name, provider);
        if (!dependsOn.includes(provider)) dependsOn.push(provider);
      } else if (!isBuiltinCallable(name)) {
        unresolved.push(name);
      }
    }

    analyses.set(region.id, {
      id: region.id,
      ...source,
      dependsOn,
      resolved,
      unresolved,
      provides: defines === undefined ? [] : [defines],
    });

    for (const dep of dependsOn) {
      const list = dependents.get(dep);
      if (list) list.push(region.id);
      else dependents.set(dep, [region.id]);
    }

    // Registered AFTER resolving reads, so `x := x + 1 ft` reads the previous
    // binding rather than itself. Self-reference is then impossible by
    // construction, which is why there is no cycle detection here.
    if (defines !== undefined) binding.set(defines, region.id);
  }

  return {
    order: ordered.map((r) => r.id),
    analyses,
    dependents,
  };
}

/** A region plus everything downstream of it, in evaluation order. */
export function transitiveDependents(
  graph: Graph,
  roots: Iterable<RegionId>,
): Set<RegionId> {
  const affected = new Set<RegionId>();
  const stack = [...roots];
  while (stack.length > 0) {
    const id = stack.pop() as RegionId;
    if (affected.has(id)) continue;
    affected.add(id);
    for (const d of graph.dependents.get(id) ?? []) stack.push(d);
  }
  return affected;
}
