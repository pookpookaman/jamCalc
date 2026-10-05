#!/usr/bin/env node
/**
 * Executable entry point.
 *
 * Separate from `main.ts` so the command implementations can be imported and
 * tested without a module-load side effect that parses `process.argv` and
 * sets an exit code.
 */
import { main } from "./main.js";

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
