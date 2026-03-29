#!/usr/bin/env node
const { spawn, execSync } = require('child_process');
const path = require('path');

// Windows 终端切换到 UTF-8，避免中文日志乱码
if (process.platform === 'win32') {
  try { execSync('chcp 65001', { stdio: 'pipe' }); } catch {}
}

const VITE = path.join(__dirname, '../node_modules/vite/bin/vite.js');
const ELECTRON = path.join(__dirname, '../node_modules/electron/dist/electron.exe');

let actualPort = null;
let electronLaunched = false;

// Start Vite with pipe so we can read its output
const vite = spawn('node', [VITE], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env },
});

// Parse the port from Vite's stdout (strip ANSI color codes first)
vite.stdout.on('data', (chunk) => {
  const raw = chunk.toString();
  process.stdout.write(raw); // still print to terminal

  if (!electronLaunched) {
    // Strip ANSI escape codes before matching
    const text = raw.replace(/\x1b\[[0-9;]*m/g, '');
    const match = text.match(/localhost:(\d+)/);
    if (match) {
      actualPort = match[1];
      electronLaunched = true;
      setTimeout(() => launchElectron(actualPort), 500);
    }
  }
});

vite.on('error', (e) => console.error('Vite error:', e.message));

function launchElectron(port) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.VITE_DEV_SERVER_URL = `http://localhost:${port}`;
  env.NODE_ENV = 'development';

  const electron = spawn(ELECTRON, ['.'], {
    stdio: 'inherit',
    env,
    cwd: path.join(__dirname, '..'),
  });

  electron.on('close', (code) => {
    vite.kill();
    process.exit(code || 0);
  });
}

process.on('exit', () => vite.kill());
process.on('SIGINT', () => { vite.kill(); process.exit(0); });
