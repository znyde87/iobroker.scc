#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const widgetSrc = path.join(rootDir, 'vis2-widgets');
// Package root widgets/ – Admin/vis-2 laden Widget-URL oft relativ zum Adapter-Root
const outDir = path.join(rootDir, 'widgets', 'scc');

if (!fs.existsSync(widgetSrc)) {
  console.error('vis2-widgets folder not found. Run from repo root.');
  process.exit(1);
}

// Install dependencies (and optional deps like @rollup/rollup-linux-*) for current platform
console.log('Installing vis2-widgets dependencies...');
execSync('npm install', { cwd: widgetSrc, stdio: 'inherit' });

console.log('Building VIS 2 widgets...');
execSync('npm run build', { cwd: widgetSrc, stdio: 'inherit' });

const buildFile = path.join(widgetSrc, 'build', 'customWidgets.js');
if (!fs.existsSync(buildFile)) {
  console.error('Build did not produce customWidgets.js');
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function copyFile(src, dest) {
  try {
    fs.copyFileSync(src, dest);
  } catch (err) {
    if (err.code === 'EPERM') {
      console.error('');
      console.error('Kopieren fehlgeschlagen: Keine Schreibrechte für widgets/scc/.');
      console.error('Als root ausführen: chown -R iobroker:iobroker "' + rootDir + '"');
      console.error('');
      process.exit(1);
    }
    throw err;
  }
}

copyFile(buildFile, path.join(outDir, 'customWidgets.js'));

// Copy only assets/ (JS chunks). Skip index.html, @mf-types, etc.
const buildAssets = path.join(widgetSrc, 'build', 'assets');
if (fs.existsSync(buildAssets)) {
  const destAssets = path.join(outDir, 'assets');
  if (!fs.existsSync(destAssets)) fs.mkdirSync(destAssets, { recursive: true });
  for (const name of fs.readdirSync(buildAssets)) {
    const srcPath = path.join(buildAssets, name);
    if (fs.statSync(srcPath).isFile()) {
      copyFile(srcPath, path.join(destAssets, name));
    }
  }
}

console.log('Widgets copied to widgets/scc/');
