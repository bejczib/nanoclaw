#!/usr/bin/env node
// Patch Wk 10-13 Thu reps and Sat fast-finishes to race pace (~3:47/km)
// after recalibrating HM target from sub-1:18 to sub-1:19:30.

'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

(function loadDotEnv() {
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'container', 'skills', 'sheets', '.env'),
  ];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
    break;
  }
})();

const TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TAB        = 'Weekly Plans';

const PATCHES = {
  '2026-06-29': {
    thu:   '3km WU + 2x5km @ 3:47/km (4min jog) + 2km CD (~16km) — first RP block',
    sat:   '26km long — first 20km Z2, last 6km @ 3:47/km RP (gel km 14)',
    notes: 'Phase 3 cornerstone. ★ MILESTONE Tue: 12km @ 3:53 — confirms threshold extends past 10km. HR <171 = on track for sub-1:20. First RP work Thu @ 3:47/km. Practice gel/water on Sat long run.',
  },
  '2026-07-06': {
    thu:   '3km WU + 3x5km @ 3:47/km (4min jog) + 2km CD (~20km) — biggest RP session (15km @ RP)',
    sat:   '28km long — first 18km Z2, last 10km @ 3:48/km RP (gel km 14)',
    notes: 'Peak RP volume — 15km @ race pace on Thu. Heaviest week. Extra-easy Fri to protect Sat. Sat 28km w/ 10km @ RP is the critical aerobic+specific stimulus before Wk 13 KEY TEST.',
  },
  '2026-07-13': {
    thu:   '3km WU + 5x1km @ 3:25/km (2min jog) + 2km CD (~12km) — VO2 jolt',
    sat:   '28km long — first 20km Z2, last 8km @ 3:47/km RP (race rehearsal)',
    notes: 'Tempo extends to 14km @ 3:50 — never done before. Strength → maintenance (drop 20%, 2 sets) to protect Tue. Thu VO2 jolt keeps top-end sharp. Sat fast-finish 8km @ RP is race-pace dress rehearsal.',
  },
  '2026-07-20': {
    thu:   '3km WU + 3x3km @ 3:46/km (3min jog) + 2km CD (~14km) — RP-tight reps',
    sat:   '28km long — first 16km Z2, last 12km @ 3:47/km RP (biggest fast-finish)',
    notes: '★★ KEY TEST Tue: 16km @ 3:50/km. Sub-1:20 confirmation. HR <168 controlled = stretch toward sub-1:19. HR 168-172 = sub-1:20 on track. HR >172 or had to slow = 1:20:30+. Leads into Wk 14 recovery (-20%).',
  },
};

function die(msg) { console.error('Error:', msg); process.exit(1); }

function base64url(s) {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeJWT(email, key) {
  const now = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: TOKEN_URL, exp: now + 3600, iat: now,
  }));
  const unsigned = `${header}.${payload}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${unsigned}.${sig}`;
}

function httpRequest(method, url, token, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const keyB64 = process.env.GOOGLE_SHEETS_KEY_JSON;
  if (!keyB64) die('GOOGLE_SHEETS_KEY_JSON missing');
  const creds = JSON.parse(Buffer.from(keyB64, 'base64').toString('utf8'));
  const jwt   = makeJWT(creds.client_email, creds.private_key);
  return new Promise((resolve, reject) => {
    const body = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
    const u = new URL(TOKEN_URL);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(raw);
          if (r.access_token) resolve(r.access_token);
          else reject(new Error('Token error: ' + raw));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function main() {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) die('GOOGLE_SHEETS_ID missing');
  const token = await getAccessToken();

  // Read the Weekly Plans tab to find row indices
  const range = encodeURIComponent(`'${TAB}'!A:L`);
  const readRes = await httpRequest('GET', `${SHEETS_API}/${sheetId}/values/${range}`, token);
  if (readRes.status !== 200) die('Read failed: ' + JSON.stringify(readRes.body));
  const rows = readRes.body.values || [];

  // Build row index map: week_start -> 1-based row number
  const rowIndex = {};
  for (let i = 1; i < rows.length; i++) {
    const ws = rows[i][0];
    if (ws) rowIndex[ws] = i + 1;
  }

  // Construct batch update requests
  // Column mapping: A=WeekStart, B=Week#, C=Phase, D=Mon, E=Tue, F=Wed, G=Thu, H=Fri, I=Sat, J=Sun, K=Volume, L=Notes
  const data = [];
  for (const [weekStart, patch] of Object.entries(PATCHES)) {
    const rowNum = rowIndex[weekStart];
    if (!rowNum) {
      console.warn(`! Row not found for ${weekStart} — skipping`);
      continue;
    }
    data.push({ range: `'${TAB}'!G${rowNum}`, values: [[patch.thu]] });
    data.push({ range: `'${TAB}'!I${rowNum}`, values: [[patch.sat]] });
    data.push({ range: `'${TAB}'!L${rowNum}`, values: [[patch.notes]] });
    console.log(`Queued ${weekStart} (row ${rowNum})`);
  }

  if (!data.length) die('Nothing to patch');

  const writeRes = await httpRequest('POST', `${SHEETS_API}/${sheetId}/values:batchUpdate`, token, {
    valueInputOption: 'USER_ENTERED',
    data,
  });
  if (writeRes.status !== 200) die('Write failed: ' + JSON.stringify(writeRes.body));
  console.log(`\n✓ Updated ${writeRes.body.totalUpdatedCells} cells across ${writeRes.body.totalUpdatedRows} rows`);
}

main().catch(e => die(e.message));
