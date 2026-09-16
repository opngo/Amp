#!/usr/bin/env node
/**
 * Amp doctor: checks the things that make `npm run dev:desktop` fail with
 * confusing errors, and repairs the ones it can.
 *
 *   node scripts/check-env.mjs           check and report, exit 1 on problems
 *   node scripts/check-env.mjs --fix     repair what is repairable
 *   node scripts/check-env.mjs --quiet   only print problems
 *   node scripts/check-env.mjs --hook    what npm postinstall runs: quiet,
 *                                        repairs if it can, and never fails
 *                                        the install. A half-finished tree is
 *                                        normal while npm is still working, so
 *                                        an install must not be aborted for
 *                                        reporting it.
 *
 * The one this exists for: if Electron's postinstall did not download its
 * binary (blocked download, an install run with --ignore-scripts, a timeout, a
 * half-finished `npm install`), `electron-vite` reports
 *
 *   Error: Electron uninstall
 *
 * or Windows shows "Unable to find Electron app at <path>\install". Amp's
 * binary is fine; the `path.txt` file that points at it is missing. Running
 * Electron's own installer again is all it takes, which is what --fix does.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const hook = args.has("--hook");
// The postinstall hook is advisory: it may repair Electron's binary, but it
// must never turn a working `npm install` into a failing one.
const quiet = args.has("--quiet") || hook;
const fix = args.has("--fix") || args.has("--ensure-electron");

// The browser build and the Python companions run on Node 20, but the desktop
// app does not: Electron 44 asks for Node 22.12 or newer, and npm says so out
// loud with EBADENGINE warnings. Treating 20 as fully supported here is what
// made those warnings look mysterious.
const REQUIRED_NODE_MAJOR = 20;
const DESKTOP_NODE_MAJOR = 22;
const DESKTOP_NODE_MINOR = 12;
const problems = [];
const notes = [];

const say = (line = "") => {
  if (!quiet) console.log(line);
};
/** Prints even in quiet mode: repairs are rare and worth seeing. */
const always = (line = "") => console.log(line);
const problem = (line) => {
  problems.push(line);
  console.log(`  problem   ${line}`);
};
const note = (line) => {
  notes.push(line);
  say(`  note      ${line}`);
};
const ok = (line) => say(`  ok        ${line}`);

const isWindows = process.platform === "win32";

/* ------------------------------------------------------------------- Node */

function checkNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < REQUIRED_NODE_MAJOR) {
    problem(`Node ${process.versions.node} is too old, Amp needs ${REQUIRED_NODE_MAJOR} or newer`);
    return;
  }
  if (major < DESKTOP_NODE_MAJOR || (major === DESKTOP_NODE_MAJOR && minor < DESKTOP_NODE_MINOR)) {
    ok(`Node ${process.versions.node}`);
    note(
      `the browser build and the Python tools are fine on Node ${major}, but the desktop app needs ` +
        `${DESKTOP_NODE_MAJOR}.${DESKTOP_NODE_MINOR} or newer (Electron 44) - npm will warn with EBADENGINE`,
    );
    return;
  }
  ok(`Node ${process.versions.node}`);
}

/* ----------------------------------------------------------- dependencies */

const REQUIRED_PACKAGES = ["vite", "electron", "electron-vite", "react", "typescript"];

/**
 * Where a package actually landed.
 *
 * npm hoists most packages to the root node_modules, but not all: a dependency
 * of a single workspace (Electron belongs to the desktop app) is often nested
 * inside it. Looking only at the root reports "incomplete install" for a
 * perfectly good one, which then sends people off to reinstall for nothing.
 */
function packageDir(name) {
  const candidates = [path.join(root, "node_modules", name)];
  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir)) {
      candidates.push(path.join(groupDir, entry, "node_modules", name));
    }
  }
  return candidates.find((candidate) => existsSync(path.join(candidate, "package.json"))) ?? null;
}

function checkDependencies() {
  const modules = path.join(root, "node_modules");
  if (!existsSync(modules)) {
    if (hook) return false;
    problem("node_modules is missing - run `npm install`");
    return false;
  }

  const missing = REQUIRED_PACKAGES.filter((name) => !packageDir(name));
  if (missing.length) {
    if (hook) return false;
    problem(`node_modules is incomplete, missing: ${missing.join(", ")} - run \`npm install\``);
    return false;
  }

  ok(`dependencies installed (${REQUIRED_PACKAGES.length} checked)`);
  return true;
}

/* --------------------------------------------------------------- Electron */

function electronDir() {
  return packageDir("electron") ?? path.join(root, "node_modules", "electron");
}

/** true when Electron's binary is present and the shim points at it. */
function electronHealthy() {
  const dir = electronDir();
  if (!existsSync(path.join(dir, "package.json"))) return false;
  const pathFile = path.join(dir, "path.txt");
  if (!existsSync(pathFile)) return false;
  const relative = readFileSync(pathFile, "utf8").trim();
  if (!relative) return false;
  return existsSync(path.join(dir, "dist", relative));
}

function installElectron() {
  const installer = path.join(electronDir(), "install.js");
  if (!existsSync(installer)) return false;
  // Electron's own installer: cached downloads make this quick, a fresh
  // download is about 100 MB.
  const result = spawnSync(process.execPath, [installer], {
    cwd: electronDir(),
    stdio: quiet ? "ignore" : "inherit",
  });
  return result.status === 0;
}

function checkElectron(runnable) {
  if (!runnable) return;
  // Mid-install, Electron's folder may not exist yet: nothing to say about it.
  if (hook && !existsSync(path.join(electronDir(), "package.json"))) return;
  if (electronHealthy()) {
    const version = JSON.parse(readFileSync(path.join(electronDir(), "package.json"), "utf8")).version;
    ok(`Electron ${version} binary present`);
    return;
  }

  if (fix) {
    always("");
    always("  Electron's binary is missing, repairing it now...");
    if (installElectron() && electronHealthy()) {
      always("  Electron repaired.");
      return;
    }
    always("  The repair did not work - see the steps below.");
  }

  problem(
    "Electron's binary is missing - this is what makes Electron uninstall or Unable to find Electron app appear",
  );
  if (hook) return;
  say("");
  say("  Fix it with any of these, from the repository root:");
  say("");
  say(
    isWindows ? "    node node_modules\\electron\\install.js" : "    node node_modules/electron/install.js",
  );
  say("");
  say("  ...or, if that fails, reinstall the package on its own:");
  say("");
  say(
    isWindows
      ? "    rmdir /s /q node_modules\\electron  &&  npm install"
      : "    rm -rf node_modules/electron && npm install",
  );
  say("");
  say("  If the download is blocked, check `npm config get ignore-scripts` (it must be false),");
  say("  then any proxy or antivirus that might be stopping the ~100 MB download.");
  say("");
  say("  Meanwhile `npm run dev` runs the same UI in a browser, with no Electron needed.");
}

/* ------------------------------------------------------- optional tooling */

function checkOptional() {
  const which = (command) => {
    const probe = spawnSync(isWindows ? "where" : "which", [command], { stdio: "ignore" });
    return probe.status === 0;
  };

  const optional = [
    ["ffmpeg", "writing chapters back into a file and splitting a book"],
    ["ffprobe", "reading chapter data from unusual containers"],
    ["mpv", "the Python GUI's player"],
  ];
  const absent = optional
    .filter(([command]) => !which(command))
    .map(([command, why]) => `${command} (${why})`);
  if (absent.length) note(`optional tools not found: ${absent.join(", ")}`);

  const python = spawnSync(isPythonCommand(), ["-c", "import sys; print(sys.version.split()[0])"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (python.status === 0) ok(`Python ${python.stdout.trim()} (companions available)`);
  else note("Python not found - gui.py, tui.py and server.py are optional and will be skipped");
}

function isPythonCommand() {
  if (isWindows) {
    for (const candidate of ["python", "py"]) {
      if (spawnSync("where", [candidate], { stdio: "ignore" }).status === 0) return candidate;
    }
    return "python";
  }
  return spawnSync("which", ["python3"], { stdio: "ignore" }).status === 0 ? "python3" : "python";
}

/* ------------------------------------------------------------------- main */

say("");
say("Amp doctor");
say("");
checkNode();
const dependenciesReady = checkDependencies();
checkElectron(dependenciesReady);
say("");
checkOptional();
say("");

if (hook) {
  // Repairs have already been attempted above; the install continues either way.
  process.exit(0);
}

if (problems.length === 0) {
  say("  Everything needed to develop is in place. Try:");
  say("");
  say("    npm run dev            the UI in a browser");
  say("    npm run dev:desktop    the Electron app");
  say("");
  process.exit(0);
}

say(`  ${problems.length} problem${problems.length === 1 ? "" : "s"} found. See the notes above.`);
say("");
process.exit(1);
