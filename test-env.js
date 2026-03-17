/**
 * test-env.js — TerraAgnostum Pre-Flight Environment Health Check
 *
 * Run with:  node test-env.js
 *
 * Checks:
 *   1. .env.local presence & parsing
 *   2. All package.json dependencies are installed & resolvable
 *   3. Required environment variables are set
 *   4. Firebase Admin SDK can be initialised with the supplied credentials
 *   5. Firestore can be contacted (lightweight collection list ping)
 *
 * Exits with code 0 on full success, code 1 if any check fails.
 */

'use strict';

const dotenv  = require('dotenv');
const path    = require('path');
const fs      = require('fs');
const { execSync } = require('child_process');

// ─── Colour helpers (no deps required) ──────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  white:  '\x1b[97m',
  grey:   '\x1b[90m',
};

// ─── ANSI-aware padding ──────────────────────────────────────────────────────
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
function rpad(str, len) {
  const raw = stripAnsi(str);
  return str + ' '.repeat(Math.max(0, len - raw.length));
}

// ─── Report data structure ───────────────────────────────────────────────────
const report = {
  sections: [],
};

function addSection(title) {
  const section = { title, rows: [] };
  report.sections.push(section);
  return {
    ok(label, detail = '')  { section.rows.push({ status: 'ok',   label, detail }); },
    warn(label, detail = '') { section.rows.push({ status: 'warn', label, detail }); },
    fail(label, detail = '') { section.rows.push({ status: 'fail', label, detail }); },
  };
}

// ─── 0. Load .env.local ──────────────────────────────────────────────────────
const envPath = path.join(process.cwd(), '.env.local');
const envSection = addSection('.env.local');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  envSection.ok('.env.local', 'file found and loaded');
} else {
  envSection.fail('.env.local', 'file not found – create .env.local in project root');
}

// ─── 1. Dependency resolution ────────────────────────────────────────────────
const depSection = addSection('Dependencies  (package.json)');

let pkgDeps = {};
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  pkgDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
} catch (e) {
  depSection.fail('package.json', `could not parse: ${e.message}`);
}

for (const dep of Object.keys(pkgDeps)) {
  try {
    require.resolve(dep);
    // Surface the installed version
    let ver = pkgDeps[dep];
    try {
      const pkgFile = require.resolve(`${dep}/package.json`);
      ver = require(pkgFile).version || ver;
    } catch (_) { /* some packages don't expose package.json directly */ }
    depSection.ok(dep, `v${ver}`);
  } catch (_) {
    depSection.fail(dep, 'NOT INSTALLED – run `npm install`');
  }
}

// ─── 2. Environment variables ────────────────────────────────────────────────
const envVarSection = addSection('Environment Variables');

const REQUIRED_VARS = [
  { key: 'FIREBASE_PROJECT_ID',    label: 'Firebase Project ID' },
  { key: 'FIREBASE_CLIENT_EMAIL',  label: 'Firebase Client Email' },
  { key: 'FIREBASE_PRIVATE_KEY',   label: 'Firebase Private Key' },
  { key: 'STRIPE_SECRET_KEY_LIVE', label: 'Stripe Secret Key' },
  { key: 'STRIPE_WEBHOOK_SECRET_LIVE', label: 'Stripe Webhook Secret (live)' },
  { key: 'STRIPE_WEBHOOK_SECRET_LOCAL', label: 'Stripe Webhook Secret (local)' },
];

const OPTIONAL_VARS = [
  { key: 'GEMINI_API_KEY',       label: 'Gemini API Key' },
  { key: 'VITE_APP_ID',          label: 'Vite App ID' },
  { key: 'DISABLE_ROOM_GENERATION', label: 'Disable Room Generation (flag)' },
];

for (const { key, label } of REQUIRED_VARS) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    envVarSection.fail(label, `${key} is not set`);
  } else {
    // Show first 6 chars as a sanity preview without exposing secrets
    const preview = val.trim().substring(0, 6) + '…';
    envVarSection.ok(label, `${key} = ${preview}`);
  }
}

for (const { key, label } of OPTIONAL_VARS) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    envVarSection.warn(label, `${key} not set (optional)`);
  } else {
    const preview = val.trim().substring(0, 6) + '…';
    envVarSection.ok(label, `${key} = ${preview}`);
  }
}

// ─── 3. Firebase Admin initialisation & Firestore ping ──────────────────────
const fbSection = addSection('Firebase / Firestore');

async function checkFirebase() {
  let admin;
  try {
    admin = require('firebase-admin');
  } catch (_) {
    fbSection.fail('firebase-admin import', 'package not installed');
    return;
  }

  // Build the credential object from env vars
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Firestore private keys use literal \n in .env – un-escape them
  const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    fbSection.fail('credential assembly', 'FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY incomplete');
    return;
  }

  // Initialise a named app so repeated runs don't collide
  let app;
  try {
    app = admin.initializeApp(
      {
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        projectId,
      },
      'preflight-check'
    );
    fbSection.ok('SDK initialisation', `project: ${projectId}`);
  } catch (e) {
    fbSection.fail('SDK initialisation', e.message);
    return;
  }

  // Firestore lightweight ping – list root collections (quota-safe, read-only)
  let db;
  try {
    db = admin.firestore(app);
    await db.listCollections();
    fbSection.ok('Firestore connection', 'listCollections() succeeded ✓');
  } catch (e) {
    // Distinguish auth vs. network errors
    if (e.code === 7 || (e.message || '').includes('PERMISSION_DENIED')) {
      fbSection.fail('Firestore connection', `Permission denied – check service account roles: ${e.message}`);
    } else if ((e.message || '').includes('ENOTFOUND') || (e.message || '').includes('ECONNREFUSED')) {
      fbSection.fail('Firestore connection', `Network error – no internet access? ${e.message}`);
    } else {
      fbSection.fail('Firestore connection', e.message);
    }
  } finally {
    try { await app.delete(); } catch (_) {}
  }
}

// ─── PRINT REPORT ────────────────────────────────────────────────────────────
function printReport() {
  const LINE = '─'.repeat(72);
  const DLINE = '═'.repeat(72);

  const icon = { ok: `${C.green}✔${C.reset}`, warn: `${C.yellow}⚠${C.reset}`, fail: `${C.red}✖${C.reset}` };
  const badge = { ok: `${C.green}PASS${C.reset}`, warn: `${C.yellow}WARN${C.reset}`, fail: `${C.red}FAIL${C.reset}` };

  console.log(`\n${C.bold}${C.cyan}${DLINE}${C.reset}`);
  console.log(`${C.bold}${C.white}  TerraAgnostum — Environment Health Report${C.reset}   ${C.grey}${new Date().toISOString()}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${DLINE}${C.reset}\n`);

  let totalOk = 0, totalWarn = 0, totalFail = 0;

  for (const section of report.sections) {
    console.log(`${C.bold}  ${section.title}${C.reset}`);
    console.log(`  ${C.dim}${LINE.slice(2)}${C.reset}`);

    for (const row of section.rows) {
      const ic  = icon[row.status];
      const lbl = rpad(`  ${ic}  ${row.label}`, 48);
      const det = row.detail ? `${C.dim}${row.detail}${C.reset}` : '';
      console.log(`${lbl}${det}`);

      if (row.status === 'ok')   totalOk++;
      if (row.status === 'warn') totalWarn++;
      if (row.status === 'fail') totalFail++;
    }

    console.log();
  }

  // Summary banner
  console.log(`${C.bold}${C.cyan}${DLINE}${C.reset}`);
  const overall = totalFail > 0 ? badge.fail : totalWarn > 0 ? badge.warn : badge.ok;
  console.log(
    `${C.bold}  Summary: ${overall}${C.reset}` +
    `   ${C.green}${totalOk} passed${C.reset}` +
    `  ${C.yellow}${totalWarn} warning${totalWarn !== 1 ? 's' : ''}${C.reset}` +
    `  ${C.red}${totalFail} failure${totalFail !== 1 ? 's' : ''}${C.reset}`
  );
  console.log(`${C.bold}${C.cyan}${DLINE}${C.reset}\n`);

  return totalFail;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
(async () => {
  await checkFirebase();

  const failures = printReport();
  process.exit(failures > 0 ? 1 : 0);
})();
