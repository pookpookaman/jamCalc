/**
 * The desktop app against the studio's dev server, so an edit to the studio
 * reloads in the window exactly as it does in a browser.
 *
 * Reuses a dev server that is already answering; otherwise starts one and
 * waits for it. Then starts Electron with ELECTRON_RENDERER_URL pointing at it
 * — the variable main.ts reads to load a URL instead of the built files. When
 * the window closes, the server this script started is stopped with it.
 *
 * Vite is run with Node directly rather than through npm: on Windows a server
 * started through a shell outlives the shell when it is killed.
 */

const { spawn } = require("node:child_process");
const http = require("node:http");
const { dirname, join } = require("node:path");

const url = process.env.ELECTRON_RENDERER_URL || "http://localhost:5173";

function answering() {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let server = null;
  if (await answering()) {
    console.log(`using the dev server already at ${url}`);
  } else {
    const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
    server = spawn(process.execPath, [vite, "--port", new URL(url).port, "--strictPort"], {
      cwd: join(__dirname, "../../studio"),
      stdio: "inherit",
    });
    for (let i = 0; i < 60 && !(await answering()); i++) await sleep(500);
    if (!(await answering())) {
      console.error(`the dev server did not come up at ${url}`);
      server.kill();
      process.exit(1);
    }
  }

  // Required from Node, the electron package is the path to its binary.
  const app = spawn(require("electron"), ["."], {
    cwd: join(__dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RENDERER_URL: url },
  });
  app.on("exit", (code) => {
    if (server) server.kill();
    process.exit(code ?? 0);
  });
}

void main();
