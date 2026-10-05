/**
 * A worksheet: regions, their evaluation order, and cached results.
 *
 * Incremental recompute works by walking the whole sheet in
 * evaluation order but only *evaluating* dirty regions. Clean definitions
 * contribute their cached value to the environment without being re-run, so
 * the environment stays correct while the expensive part is skipped.
 *
 * Everything here is an operation the API will expose. The GUI
 * gets no privileged path — if the GUI needs something this class cannot do,
 * that is a bug in this class.
 */

import { CalcError } from "../errors.js";
import {
  evaluateStatement,
  setValue,
  type Binding,
  type Environment,
} from "../eval.js";
import type { Value } from "../value.js";
import { evaluateTable, isBlankTable } from "./table.js";
import { buildPlot, isBlankPlot, type PlotModel } from "./plot.js";
import { resolveReferences, type TextRun } from "./text.js";
import { formatNumber } from "./format.js";
import { formatMatrix } from "./projection.js";
import { preferredUnit } from "../units/prefer.js";
import { valueIn } from "../units/parse.js";
import { isMatrix } from "../value.js";
import {
  analyzeSource,
  buildGraph,
  transitiveDependents,
  type Graph,
  type RegionAnalysis,
  type SourceAnalysis,
} from "./graph.js";
import type { OrderOptions } from "./order.js";
import type { Region, RegionId, RegionResult } from "./region.js";

function sameNames(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}

export interface RecomputeStats {
  /** Regions actually evaluated. The number incremental recompute exists to
   * keep small. */
  readonly evaluated: number;
  /** Regions served from cache. */
  readonly reused: number;
}

export interface SymbolInfo {
  readonly name: string;
  readonly definedIn: RegionId;
  readonly value: Value;
}

export class Worksheet {
  private regions = new Map<RegionId, Region>();
  private results = new Map<RegionId, RegionResult>();
  private graph: Graph;
  /**
   * Parsed source per region, kept separate from the graph.
   *
   * The graph is a snapshot of *structure*; an in-place source edit changes
   * content without changing structure, and evaluating from the graph's cached
   * parse would then run the pre-edit source. Splitting them makes that class
   * of staleness bug impossible rather than merely avoided.
   */
  private parsed = new Map<RegionId, SourceAnalysis>();
  /**
   * Function bindings by region.
   *
   * A cached result holds a Quantity, which cannot represent a function. When
   * a clean function region is reused, its binding has to come from somewhere
   * — without this, reusing it rebound the name to a meaningless value and
   * every caller reported "not a function".
   */
  private functionBindings = new Map<RegionId, Binding>();
  /**
   * Column values by table region.
   *
   * A table binds several names, and `RegionResult`'s `ok` shape carries one
   * value. Rather than widen that everywhere, a good table has no result at
   * all and its columns live here; a bad one gets an `error` result like any
   * other region. Regions reading a failed table's column then come out
   * `blocked` through the existing path, naming the table.
   */
  private tableValues = new Map<RegionId, ReadonlyMap<string, Value>>();
  /**
   * Drawable models by plot region. Like a table's columns, these sit beside
   * the results rather than inside them: a plot has a picture, not a value.
   */
  private plotModels = new Map<RegionId, PlotModel>();
  /**
   * Prose with its references filled in.
   *
   * Beside the results for the same reason a table's columns are: a text
   * region has no single value, and the renderer needs the runs as the reader
   * will see them.
   */
  private textRuns = new Map<RegionId, readonly TextRun[]>();
  private dirty = new Set<RegionId>();
  /** Set when region membership or positions changed, forcing a graph rebuild. */
  private structuralChange = true;

  constructor(
    regions: readonly Region[] = [],
    private readonly options: OrderOptions = {},
  ) {
    for (const r of regions) this.regions.set(r.id, r);
    this.graph = buildGraph([...this.regions.values()], this.options);
    this.syncParsed();
  }

  private syncParsed(): void {
    this.parsed.clear();
    this.functionBindings.clear();
    this.tableValues.clear();
    this.plotModels.clear();
    this.textRuns.clear();
    for (const [id, a] of this.graph.analyses) this.parsed.set(id, a);
  }

  // --- mutation -----------------------------------------------------------

  insert(region: Region): void {
    this.regions.set(region.id, region);
    this.structuralChange = true;
  }

  remove(id: RegionId): boolean {
    const existed = this.regions.delete(id);
    if (existed) {
      this.results.delete(id);
      this.tableValues.delete(id);
      this.plotModels.delete(id);
      this.textRuns.delete(id);
      this.structuralChange = true;
    }
    return existed;
  }

  move(id: RegionId, position: Region["position"]): void {
    const region = this.regions.get(id);
    if (!region) throw new Error(`no region ${id}`);
    this.regions.set(id, { ...region, position });
    // Moving a region can change evaluation order, and therefore which
    // definition every later reference binds to. Nothing is safe to reuse.
    this.structuralChange = true;
  }

  /**
   * Edits a math region's source.
   *
   * The cheap path requires that the edit changed neither the name defined nor
   * the set of names read. Only then is the binding structure provably
   * identical, so invalidating this region and its transitive dependents is
   * sufficient. Change either one and a name somewhere else may now resolve to
   * a different region, which only a graph rebuild can work out.
   */
  edit(id: RegionId, source: string): void {
    const region = this.regions.get(id);
    if (!region) throw new Error(`no region ${id}`);
    if (region.kind !== "math") throw new Error(`region ${id} is not math`);

    const before = this.graph.analyses.get(id);
    this.regions.set(id, { ...region, source });
    const after = analyzeSource(source);

    const sameDefinition =
      before !== undefined &&
      before.defines === after.defines &&
      sameNames(before.reads, after.reads);

    if (sameDefinition) {
      // The cached parse is now stale — replacing it is the whole point of the
      // edit, and forgetting to would silently evaluate the old source.
      this.parsed.set(id, after);
      this.markDirty([id]);
    } else {
      this.structuralChange = true;
    }
  }

  private markDirty(roots: readonly RegionId[]): void {
    for (const id of transitiveDependents(this.graph, roots)) {
      this.dirty.add(id);
    }
  }

  // --- evaluation ---------------------------------------------------------

  recompute(): RecomputeStats {
    if (this.structuralChange) {
      this.graph = buildGraph([...this.regions.values()], this.options);
      this.syncParsed();
      this.dirty = new Set(this.graph.order);
      this.structuralChange = false;
    }

    const env: Environment = new Map();
    let evaluated = 0;
    let reused = 0;

    for (const id of this.graph.order) {
      const region = this.regions.get(id);
      const analysis = this.graph.analyses.get(id);
      if (!region || !analysis) continue;

      if (region.kind === "table") {
        const cachedColumns = this.dirty.has(id) ? undefined : this.tableValues.get(id);
        if (cachedColumns) {
          reused++;
          for (const [name, value] of cachedColumns) setValue(env, name, value);
          continue;
        }
        if (isBlankTable(region)) {
          // Nothing typed in yet: no values, no error, no marker.
          this.tableValues.delete(id);
          this.results.delete(id);
          continue;
        }
        evaluated++;
        try {
          const { values } = evaluateTable(region);
          this.tableValues.set(id, values);
          this.results.delete(id);
          for (const [name, value] of values) setValue(env, name, value);
        } catch (e) {
          // A half-typed table must not take the sheet down; it reports its
          // own error and everything reading it comes out blocked.
          this.tableValues.delete(id);
          this.results.set(id, {
            status: "error",
            error:
              e instanceof CalcError
                ? e
                : new CalcError("domain", (e as Error).message, [0, 0]),
          });
        }
        continue;
      }

      if (region.kind === "text") {
        if (analysis.reads.size === 0) {
          this.textRuns.delete(id);
          this.results.delete(id);
          continue;
        }
        evaluated++;
        const missing: string[] = [];
        const runs = resolveReferences(region.runs, (name) => {
          const bound = env.get(name);
          if (bound?.kind !== "value") {
            missing.push(name);
            return undefined;
          }
          return this.formatReference(bound.value);
        });
        this.textRuns.set(id, runs);
        // A name the prose quotes but the sheet does not define is the same
        // mistake as one in an equation, and gets the same visible marker.
        const first = missing[0];
        if (first === undefined) this.results.delete(id);
        else {
          const blamed = analysis.resolved.get(first);
          this.results.set(
            id,
            blamed !== undefined
              ? { status: "blocked", because: blamed, missing: first }
              : {
                  status: "error",
                  error: new CalcError(
                    "undefined_name",
                    `\`${first}\` is not defined`,
                    [0, 0],
                  ),
                },
          );
        }
        continue;
      }

      if (region.kind === "plot") {
        if (isBlankPlot(region)) {
          this.plotModels.delete(id);
          this.results.delete(id);
          continue;
        }
        // A plot reads names like a math region, so a missing one it depended
        // on means the provider failed: blocked, naming that region.
        let blocked = false;
        for (const name of analysis.reads) {
          if (env.has(name)) continue;
          const blamed = analysis.resolved.get(name);
          if (blamed !== undefined) {
            this.plotModels.delete(id);
            this.results.set(id, { status: "blocked", because: blamed, missing: name });
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        evaluated++;
        try {
          this.plotModels.set(id, buildPlot(region, (name) => {
            const bound = env.get(name);
            return bound?.kind === "value" ? bound.value : undefined;
          }));
          this.results.delete(id);
        } catch (e) {
          this.plotModels.delete(id);
          this.results.set(id, {
            status: "error",
            error:
              e instanceof CalcError
                ? e
                : new CalcError("domain", (e as Error).message, [0, 0]),
          });
        }
        continue;
      }

      if (region.kind !== "math") continue;

      // A region the user has just created is empty. It is not a syntax
      // error — it is a box waiting to be typed in, and flagging it would put
      // a red badge on every new region.
      if (region.source.trim() === "") {
        this.results.delete(id);
        continue;
      }

      const cached = this.results.get(id);
      if (!this.dirty.has(id) && cached) {
        reused++;
        if (cached.status === "ok" && cached.defined !== undefined) {
          const fn = this.functionBindings.get(id);
          if (fn) env.set(cached.defined, fn);
          else setValue(env, cached.defined, cached.value);
        }
        continue;
      }

      evaluated++;
      const result = this.evaluateRegion(id, analysis, env);
      this.results.set(id, result);
      if (result.status === "ok" && result.defined !== undefined) {
        // evaluateStatement already bound the name; capture a function binding
        // so a later reuse of this region can restore it.
        const bound = env.get(result.defined);
        if (bound?.kind === "function") this.functionBindings.set(id, bound);
        else {
          this.functionBindings.delete(id);
          setValue(env, result.defined, result.value);
        }
      }
    }

    this.dirty.clear();
    return { evaluated, reused };
  }

  private evaluateRegion(
    id: RegionId,
    analysis: RegionAnalysis,
    env: Environment,
  ): RegionResult {
    const source = this.parsed.get(id) ?? analysis;

    if (source.parseError instanceof CalcError) {
      return { status: "error", error: source.parseError };
    }
    if (source.parseError !== undefined) {
      return {
        status: "error",
        error: new CalcError("syntax", String(source.parseError), [0, 0]),
      };
    }

    const statement = source.statement;
    if (!statement) {
      return {
        status: "error",
        error: new CalcError("syntax", "empty region", [0, 0]),
      };
    }

    // A name the graph DID resolve, but which is absent from `env`, means the
    // region that provides it failed. Blame that specific region — and only
    // for names the graph resolved. A name in `unresolved` was never defined
    // anywhere, which is this region's own `undefined_name` error, not someone
    // else's failure.
    for (const name of [...source.reads, ...source.calls]) {
      if (env.has(name)) continue;
      const blamed = analysis.resolved.get(name);
      if (blamed !== undefined) {
        return { status: "blocked", because: blamed, missing: name };
      }
    }

    try {
      const stmt = evaluateStatement(statement, env);
      return {
        status: "ok",
        ...(stmt.defined !== undefined ? { defined: stmt.defined } : {}),
        ...(stmt.isFunction ? { isFunction: true } : {}),
        ...(stmt.showResult ? { showResult: true } : {}),
        value: stmt.value,
        ...(stmt.displayValue !== undefined
          ? { displayValue: stmt.displayValue }
          : {}),
        ...(stmt.displayUnit !== undefined
          ? { displayUnit: stmt.displayUnit }
          : {}),
      };
    } catch (e) {
      if (e instanceof CalcError) return { status: "error", error: e };
      throw e;
    }
  }

  // --- reads (the API surface) --------------------------------------------

  get order(): readonly RegionId[] {
    return this.graph.order;
  }

  /**
   * Regions whose cached result may no longer match their source.
   *
   * Exists for manual calculation mode: with recompute deferred, the UI has to
   * be able to say which values are out of date. A stale number displayed
   * beside a changed formula, with nothing to distinguish it from a fresh one,
   * is the worst failure this program can produce — it is wrong and it looks
   * right.
   *
   * After a structural change this conservatively reports every math region.
   * Inserting, deleting or moving a region can change which definition any
   * later reference binds to, and working out the real answer means rebuilding
   * the graph — which is the work being deferred.
   */
  get pending(): readonly RegionId[] {
    if (this.structuralChange) {
      return [...this.regions.values()]
        .filter((r) => r.kind === "math")
        .map((r) => r.id);
    }
    return [...this.dirty];
  }

  /** True when every cached result reflects the current source. */
  get isUpToDate(): boolean {
    return this.pending.length === 0;
  }

  getRegion(id: RegionId): Region | undefined {
    return this.regions.get(id);
  }

  getResult(id: RegionId): RegionResult | undefined {
    return this.results.get(id);
  }

  /** Every name in scope at the end of the sheet, with where it came from. */
  /**
   * How an inline reference is written into a sentence.
   *
   * The sheet's own formatting, so a value quoted in prose and the same value
   * shown beside its formula never disagree.
   */
  private formatReference(value: Value): string {
    if (isMatrix(value)) return formatMatrix(value);
    const q = value;
    if (q.dimension.isDimensionless) return formatNumber(q.si);
    const unit = preferredUnit(q.dimension);
    return unit === undefined
      ? `${formatNumber(q.si)} ${q.dimension.toString()}`
      : `${formatNumber(valueIn(q, unit))} ${unit}`;
  }

  /** Prose with its references resolved, when the region has any. */
  getRuns(id: RegionId): readonly TextRun[] | undefined {
    return this.textRuns.get(id);
  }

  /** The drawable model for a plot region, when it has one. */
  getPlot(id: RegionId): PlotModel | undefined {
    return this.plotModels.get(id);
  }

  listSymbols(): SymbolInfo[] {
    const out = new Map<string, SymbolInfo>();
    for (const id of this.graph.order) {
      // A table's columns are definitions too, and a reader orienting itself
      // in someone else's sheet needs to see where a lookup column came from.
      const columns = this.tableValues.get(id);
      if (columns) {
        for (const [name, value] of columns) out.set(name, { name, definedIn: id, value });
        continue;
      }
      const r = this.results.get(id);
      if (r?.status === "ok" && r.defined !== undefined && !r.isFunction) {
        out.set(r.defined, { name: r.defined, definedIn: id, value: r.value });
      }
    }
    return [...out.values()];
  }

  /** What feeds this region — the single most useful question when checking
   * someone else's calc. */
  trace(id: RegionId): RegionId[] {
    const seen = new Set<RegionId>();
    const stack = [...(this.graph.analyses.get(id)?.dependsOn ?? [])];
    while (stack.length > 0) {
      const next = stack.pop() as RegionId;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(this.graph.analyses.get(next)?.dependsOn ?? []));
    }
    return this.graph.order.filter((r) => seen.has(r));
  }
}
