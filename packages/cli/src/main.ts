/**
 * `calc` — the document API from a terminal.
 *
 * A thin wrapper: every command is one call into `@jamcalc/engine`'s
 * operations, with argument parsing either side. If a command here needs logic
 * the operations do not have, that logic belongs in the engine — the CLI, the
 * GUI and any future server must not be able to disagree about what an
 * operation means.
 */

import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  ApiError,
  applyPatch,
  evaluate,
  exportSheet,
  getRegion,
  getSheet,
  listRegions,
  listSymbolReports,
  parseSheet,
  serializeSheet,
  setInputs,
  traceRegion,
  type ExportFormat,
  type PatchOperation,
  type Sheet,
} from "@jamcalc/engine";

const USAGE = `calc — read and edit calculation sheets

  calc show <file>                    the sheet as text
  calc regions <file>                 one line per region, in evaluation order
  calc symbols <file>                 every defined name and its value
  calc trace <file> <region>          what feeds a region
  calc eval <file>                    run it
  calc set <file> --set n=v ...       set inputs and save
  calc patch <file> <ops.json>        apply operations atomically and save
  calc export <file> --as csv|json|text [-o out]

Options
  --set name=value    input override, repeatable. Every command that reads a
                      sheet honours it without saving; only \`set\` saves it
  -o, --out <file>    write here instead of stdout
  --client <name>     recorded as the author of any change (default: cli)
  --dry-run           print what would be written, change nothing
  --version           print this build's version
`;

/**
 * This build's version (ADR-0016): the package's own, which is the product's.
 * Read at run time from beside the code, in `src/` and `dist/` alike.
 */
export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "";
  } catch {
    return "";
  }
})();

class UsageError extends Error {}

interface Args {
  readonly command: string;
  readonly positional: string[];
  readonly set: Record<string, string>;
  readonly out?: string;
  readonly client: string;
  readonly dryRun: boolean;
  readonly as?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const set: Record<string, string> = {};
  let out: string | undefined;
  let as: string | undefined;
  let client = "cli";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--set") {
      const pair = argv[++i];
      if (!pair) throw new UsageError("--set needs name=value");
      const eq = pair.indexOf("=");
      if (eq <= 0) throw new UsageError(`--set needs name=value, got \`${pair}\``);
      set[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    } else if (arg === "-o" || arg === "--out") {
      out = argv[++i];
      if (!out) throw new UsageError("--out needs a path");
    } else if (arg === "--as") {
      as = argv[++i];
      if (!as) throw new UsageError("--as needs a format");
    } else if (arg === "--client") {
      client = argv[++i] ?? "cli";
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--version" || arg === "-v") {
      positional.unshift("version");
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option \`${arg}\``);
    } else {
      positional.push(arg);
    }
  }

  const [command = "", ...rest] = positional;
  return {
    command,
    positional: rest,
    set,
    ...(out !== undefined ? { out } : {}),
    ...(as !== undefined ? { as } : {}),
    client,
    dryRun,
  };
}

async function readSheet(path: string | undefined): Promise<Sheet> {
  if (!path) throw new UsageError("a sheet file is required");
  return parseSheet(await readFile(path, "utf8"));
}

/**
 * The sheet a reading command reports on: the file, with any `--set`
 * overrides applied in memory and never saved.
 *
 * One place, so every command that reads honours them. Until 30 Sep only
 * `eval` did; `symbols`, `export` and the rest ignored them without a word
 * and reported the saved inputs, which a scripted parameter study would have
 * taken for the answer.
 */
async function readWithOverrides(path: string | undefined, args: Args): Promise<Sheet> {
  const sheet = await readSheet(path);
  return Object.keys(args.set).length > 0
    ? setInputs(sheet, args.set, { client: args.client })
    : sheet;
}

async function emit(text: string, out: string | undefined): Promise<void> {
  if (out) await writeFile(out, text, "utf8");
  else process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

/**
 * Writing is separate from computing so `--dry-run` is a single decision made
 * in one place, rather than something each command remembers to honour.
 */
async function save(sheet: Sheet, path: string, args: Args): Promise<void> {
  // Every save records the version that made it (ADR-0016), whoever saved.
  const text = serializeSheet(VERSION ? { ...sheet, savedWith: VERSION } : sheet);
  if (args.dryRun) {
    process.stdout.write(text);
    return;
  }
  await writeFile(path, text, "utf8");
  process.stderr.write(`wrote ${path}\n`);
}

async function run(args: Args): Promise<number> {
  const [file, second] = args.positional;

  switch (args.command) {
    case "":
    case "help":
    case "--help":
      process.stdout.write(USAGE);
      return 0;

    case "version":
      process.stdout.write(`${VERSION}
`);
      return 0;

    case "show": {
      await emit(getSheet(await readWithOverrides(file, args)).projection, args.out);
      return 0;
    }

    case "regions": {
      const rows = listRegions(await readWithOverrides(file, args));
      const lines = rows.map((r) => {
        const value = r.result?.display ?? (r.status === "ok" ? "" : r.status);
        const detail = r.error ? ` ${r.error.code}: ${r.error.message}` : "";
        return `${r.id.padEnd(6)} ${(r.source ?? r.text ?? "").padEnd(34)} ${value}${detail}`;
      });
      await emit(lines.join("\n"), args.out);
      return rows.some((r) => r.status === "error" || r.status === "blocked") ? 1 : 0;
    }

    case "symbols": {
      const rows = listSymbolReports(await readWithOverrides(file, args));
      await emit(
        rows.map((s) => `${s.name.padEnd(14)} ${s.display.padStart(16)}   ${s.definedIn}`).join("\n"),
        args.out,
      );
      return 0;
    }

    case "trace": {
      if (!second) throw new UsageError("trace needs a region id");
      const rows = traceRegion(await readWithOverrides(file, args), second);
      await emit(
        rows.map((r) => `${r.id.padEnd(6)} ${(r.source ?? "").padEnd(34)} ${r.result?.display ?? ""}`).join("\n"),
        args.out,
      );
      return 0;
    }

    case "eval": {
      const report = evaluate(await readWithOverrides(file, args));
      const lines = report.regions
        .filter((r) => r.kind === "math")
        .map((r) => {
          const shown =
            r.status === "ok"
              ? (r.result?.display ?? "")
              : r.status === "blocked"
                ? `blocked by ${r.blockedBy}`
                : (r.error?.message ?? r.status);
          return `${r.id.padEnd(6)} ${(r.source ?? "").padEnd(34)} ${shown}`;
        });
      await emit(lines.join("\n"), args.out);
      // A non-zero exit is what makes this usable in CI.
      return report.errors > 0 ? 1 : 0;
    }

    case "set": {
      if (!file) throw new UsageError("set needs a sheet file");
      if (Object.keys(args.set).length === 0) throw new UsageError("set needs at least one --set");
      const sheet = setInputs(await readSheet(file), args.set, { client: args.client });
      await save(sheet, file, args);
      return 0;
    }

    case "patch": {
      if (!file || !second) throw new UsageError("patch needs a sheet file and an operations file");
      // Which would win, and which would be saved, has no obvious answer.
      if (Object.keys(args.set).length > 0) {
        throw new UsageError("patch does not take --set; run `calc set` first, or put the change in the operations");
      }
      const ops = JSON.parse(await readFile(second, "utf8")) as PatchOperation[];
      if (!Array.isArray(ops)) throw new UsageError("the operations file must contain a JSON array");
      const { sheet, inserted } = applyPatch(await readSheet(file), ops, { client: args.client });
      if (inserted.length > 0) process.stderr.write(`inserted ${inserted.join(", ")}\n`);
      await save(sheet, file, args);
      return 0;
    }

    case "export": {
      const format = (args.as ?? "json") as ExportFormat;
      if (!["json", "csv", "text"].includes(format)) {
        throw new UsageError(`unknown format \`${format}\``);
      }
      await emit(exportSheet(await readWithOverrides(file, args), format), args.out);
      return 0;
    }

    case "region": {
      if (!second) throw new UsageError("region needs an id");
      await emit(JSON.stringify(getRegion(await readWithOverrides(file, args), second), null, 2), args.out);
      return 0;
    }

    default:
      throw new UsageError(`unknown command \`${args.command}\``);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    return await run(parseArgs(argv));
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`calc: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    if (e instanceof ApiError) {
      // Structured on stderr so a script can read it.
      process.stderr.write(`${JSON.stringify(e.toJSON())}\n`);
      return 1;
    }
    process.stderr.write(`calc: ${(e as Error).message}\n`);
    return 1;
  }
}
