#!/usr/bin/env node
/**
 * dev.mjs — unified dev runner for GenXCRM
 *
 * Usage:
 *   node dev.mjs            start docker + backend + frontend
 *   node dev.mjs start      same
 *   node dev.mjs stop       stop all services
 *   node dev.mjs restart    stop then start
 *
 * Flags:
 *   --no-docker   skip docker (useful if containers are already running)
 */

import { spawn }                                    from 'child_process';
import { dirname, join }                            from 'path';
import { fileURLToPath }                            from 'url';
import { existsSync, readFileSync, writeFileSync,
         unlinkSync }                               from 'fs';

const ROOT      = dirname(fileURLToPath(import.meta.url));
const PID_FILE  = join(ROOT, '.dev-pids.json');
const IS_WIN    = process.platform === 'win32';
const NO_DOCKER = process.argv.includes('--no-docker');

// ── ANSI ─────────────────────────────────────────────────────────────────────
const A = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
};

// Padded labels so columns align
const LABEL = {
  docker:   `${A.cyan}${A.bold}[docker  ]${A.reset}`,
  backend:  `${A.green}${A.bold}[backend ]${A.reset}`,
  frontend: `${A.magenta}${A.bold}[frontend]${A.reset}`,
  system:   `${A.blue}${A.bold}[dev     ]${A.reset}`,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function info(msg)  { console.log(`${LABEL.system} ${msg}`); }
function ok(msg)    { console.log(`${LABEL.system} ${A.green}${msg}${A.reset}`); }
function warn(msg)  { console.log(`${LABEL.system} ${A.yellow}${msg}${A.reset}`); }
function err(msg)   { console.error(`${LABEL.system} ${A.red}${A.bold}${msg}${A.reset}`); }
function hr()       { console.log(`${A.dim}${'─'.repeat(60)}${A.reset}`); }

/** Prefix every non-empty line with the service label. */
function pipe(label, stream, isStderr = false) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';          // keep partial last line in buffer
    for (const line of lines) {
      if (!line.trim()) continue;
      const colored = isStderr ? `${A.red}${line}${A.reset}` : line;
      process[isStderr ? 'stderr' : 'stdout'].write(`${label} ${colored}\n`);
    }
  });
  stream.on('end', () => {
    if (buf.trim()) {
      const colored = isStderr ? `${A.red}${buf}${A.reset}` : buf;
      process[isStderr ? 'stderr' : 'stdout'].write(`${label} ${colored}\n`);
    }
  });
}

/** Cross-platform spawn. Always pipes stdio so we can prefix output. */
function run(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    cwd: ROOT,
    shell: IS_WIN,
    stdio: 'pipe',
    ...opts,
  });
}

/** Kill a process (and its tree on Windows). */
function killPid(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      // /T = kill tree, /F = force
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { shell: true, stdio: 'ignore' });
    } else {
      // Negative PID kills the whole process group (requires detached: true on spawn)
      process.kill(-pid, 'SIGTERM');
    }
  } catch { /* process already gone */ }
}

/** Save pids so `stop` can find them from a separate invocation. */
function savePids(pids) {
  writeFileSync(PID_FILE, JSON.stringify(pids, null, 2));
}

function loadPids() {
  if (!existsSync(PID_FILE)) return null;
  try { return JSON.parse(readFileSync(PID_FILE, 'utf8')); } catch { return null; }
}

function clearPids() {
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
}

// ── Docker ────────────────────────────────────────────────────────────────────
function dockerUp() {
  return new Promise((resolve, reject) => {
    info('Starting Docker containers (postgres + redis)…');

    // Try `docker compose` (new CLI); fall back to `docker-compose` (legacy)
    const proc = run('docker', ['compose', 'up', '-d'], { cwd: ROOT });

    pipe(LABEL.docker, proc.stdout);
    pipe(LABEL.docker, proc.stderr); // docker writes progress to stderr

    proc.on('close', (code) => {
      if (code === 0) {
        ok('Docker containers ready.');
        resolve();
      } else {
        err(`Docker exited with code ${code}. Is Docker running?`);
        reject(new Error(`docker exit ${code}`));
      }
    });

    proc.on('error', (e) => {
      err(`Failed to spawn docker: ${e.message}`);
      reject(e);
    });
  });
}

function dockerStop() {
  return new Promise((resolve) => {
    info('Stopping Docker containers…');
    const proc = run('docker', ['compose', 'stop'], { cwd: ROOT });
    pipe(LABEL.docker, proc.stdout);
    pipe(LABEL.docker, proc.stderr);
    proc.on('close', (code) => {
      if (code === 0) ok('Docker containers stopped.');
      else warn(`docker compose stop exited ${code}`);
      resolve();
    });
    proc.on('error', () => resolve()); // ignore if docker not available
  });
}

// ── Service launcher ──────────────────────────────────────────────────────────
function startService(name, cwd) {
  info(`Starting ${name}…`);

  const proc = spawn('npm', ['run', 'dev'], {
    cwd,
    shell: IS_WIN,
    stdio: 'pipe',
    detached: !IS_WIN, // creates a process group on Unix for clean tree-kill
  });

  pipe(LABEL[name], proc.stdout);
  pipe(LABEL[name], proc.stderr, true);  // stderr → red

  proc.on('error', (e) => {
    err(`[${name}] spawn error: ${e.message}`);
  });

  proc.on('close', (code, signal) => {
    // Normal exits via our own shutdown — don't log noise
    if (signal === 'SIGTERM' || signal === 'SIGINT' || code === null) return;
    err(`[${name}] process exited unexpectedly (code ${code})`);
    warn(`[${name}] To restart, run:  node dev.mjs restart`);
  });

  return proc;
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  console.log(`
${A.bold}${A.cyan}╔══════════════════════════════════════╗
║      GenXCRM Dev Environment         ║
╚══════════════════════════════════════╝${A.reset}
`);

  // Step 1 — Docker
  if (NO_DOCKER) {
    warn('Skipping Docker (--no-docker flag set).');
  } else {
    try {
      await dockerUp();
    } catch {
      err('Aborting — fix Docker errors above and retry.');
      process.exit(1);
    }
  }

  hr();

  // Step 2 — Backend + Frontend (in parallel)
  const backend  = startService('backend',  join(ROOT, 'backend'));
  const frontend = startService('frontend', join(ROOT, 'frontend'));

  // Persist PIDs for external `stop` command
  savePids({ backend: backend.pid, frontend: frontend.pid });

  hr();
  console.log(`
${A.bold}Services starting…${A.reset}

  ${A.green}Backend${A.reset}   → ${A.cyan}http://localhost:3000${A.reset}
  ${A.magenta}Frontend${A.reset}  → ${A.cyan}http://localhost:5173${A.reset}

${A.dim}Press Ctrl+C to stop all services${A.reset}
`);

  // Step 3 — Graceful shutdown on Ctrl+C
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n${A.yellow}Caught ${signal} — shutting down…${A.reset}\n`);

    killPid(backend.pid);
    killPid(frontend.pid);

    if (!NO_DOCKER) await dockerStop();

    clearPids();
    ok('All services stopped. Bye!');
    process.exit(0);
  };

  process.on('SIGINT',  () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// ── Stop ──────────────────────────────────────────────────────────────────────
async function stop() {
  console.log(`\n${A.bold}${A.yellow}Stopping GenXCRM services…${A.reset}\n`);

  const pids = loadPids();

  if (pids) {
    info(`Killing backend  (pid ${pids.backend})`);
    killPid(pids.backend);

    info(`Killing frontend (pid ${pids.frontend})`);
    killPid(pids.frontend);

    clearPids();
    ok('Backend and frontend stopped.');
  } else {
    warn('No .dev-pids.json found — backend/frontend may not be running from this script.');
  }

  hr();

  if (!NO_DOCKER) await dockerStop();

  ok('Done.');
}

// ── Restart ───────────────────────────────────────────────────────────────────
async function restart() {
  await stop();
  hr();
  await start();
}

// ── Entry ─────────────────────────────────────────────────────────────────────
const cmd = process.argv.find(a => ['start','stop','restart'].includes(a)) ?? 'start';

switch (cmd) {
  case 'start':   void start();   break;
  case 'stop':    void stop();    break;
  case 'restart': void restart(); break;
}
