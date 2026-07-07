#!/usr/bin/env node
// One-off: move the duplicate/misplaced 2026-05-25 row from row 2 to its correct
// chronological position in the Workout Log (newest-first order).

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
const TAB        = 'Workout Log';
const TARGET_DATE = process.argv[2] || '2026-05-25';

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

function httpPostForm(url, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
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
    req.write(body);
    req.end();
  });
}

async function getToken() {
  const raw = process.env.GOOGLE_SHEETS_KEY_JSON;
  if (!raw) die('GOOGLE_SHEETS_KEY_JSON missing');
  const key = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  const res = await httpPostForm(TOKEN_URL, {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: makeJWT(key.client_email, key.private_key),
  });
  if (res.status !== 200) die(`Token: ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

async function main() {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) die('GOOGLE_SHEETS_ID missing');

  const token = await getToken();

  // Find numeric sheetId for the tab
  const metaRes = await httpRequest('GET', `${SHEETS_API}/${sheetId}?fields=sheets.properties`, token);
  if (metaRes.status !== 200) die(`Meta: ${JSON.stringify(metaRes.body)}`);
  const sheet = metaRes.body.sheets.find(s => s.properties.title === TAB);
  if (!sheet) die(`Tab "${TAB}" not found`);
  const wsId = sheet.properties.sheetId;

  // Read column A to find source + correct insertion point
  const readRes = await httpRequest('GET',
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(`${TAB}!A:A`)}`, token);
  if (readRes.status !== 200) die(`Read: ${JSON.stringify(readRes.body)}`);
  const dates = (readRes.body.values || []).map(r => r[0] || '');

  // Find current row of TARGET_DATE (0-indexed). Should be row 1 (just inserted at top).
  const sourceIdx = dates.indexOf(TARGET_DATE, 1);
  if (sourceIdx < 0) die(`Could not find ${TARGET_DATE} in the sheet`);

  // Find correct chronological position: in newest-first order, TARGET_DATE belongs
  // between the row immediately newer than it and the row immediately older.
  // Scan all data rows (excluding the source row and header) and find the first row
  // whose date is strictly older than TARGET_DATE — that's where TARGET_DATE goes.
  let destIdx = -1;
  for (let i = 1; i < dates.length; i++) {
    if (i === sourceIdx) continue;
    const d = dates[i];
    if (!d) continue;
    if (d < TARGET_DATE) { destIdx = i; break; }
  }
  if (destIdx < 0) die('Could not find a destination row (no older date)');

  console.log(`Source row (1-indexed): ${sourceIdx + 1} = ${dates[sourceIdx]}`);
  console.log(`Destination row (1-indexed): ${destIdx + 1} = ${dates[destIdx]} (will be pushed down)`);

  // moveDimension destinationIndex semantics (empirically verified):
  // The source row lands at the row that was at destIdx in the original layout.
  // So passing destinationIndex = destIdx places the source immediately above
  // whatever was at destIdx (which gets pushed down by one).
  const destinationIndex = destIdx;

  const moveRes = await httpRequest('POST',
    `${SHEETS_API}/${sheetId}:batchUpdate`, token, {
      requests: [{
        moveDimension: {
          source: {
            sheetId: wsId,
            dimension: 'ROWS',
            startIndex: sourceIdx,         // 0-indexed
            endIndex:   sourceIdx + 1,     // exclusive
          },
          destinationIndex,
        },
      }],
    });
  if (moveRes.status !== 200) die(`Move: ${JSON.stringify(moveRes.body)}`);

  // Verify
  const verifyRes = await httpRequest('GET',
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(`${TAB}!A:A`)}`, token);
  const newDates = (verifyRes.body.values || []).map(r => r[0] || '');
  const newPos = newDates.indexOf(TARGET_DATE, 1);
  console.log(`After move: ${TARGET_DATE} is now at row ${newPos + 1}`);
  console.log(`  Row above: ${newDates[newPos - 1] || '(header)'}`);
  console.log(`  Row below: ${newDates[newPos + 1] || '(end)'}`);
}

main().catch(e => die(e.message));
