#!/usr/bin/env node
// One-off: backfill missing Distance/Duration in Workout Log for May 21 → Jun 6 2026.
// Required because sheets log-workout silently dropped actual_distance / actual_duration
// fields documented in SKILL.md but not read by the script (fixed in same change).

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

// Source-of-truth values from Strava `range 2026-05-21 → 2026-06-06`.
// Long-run durations are minute-precision (Strava `detail` does not return seconds for 1h+ activities).
const BACKFILL = {
  '2026-06-06': { distance: 15.07, duration: '1:15:00' },
  '2026-06-05': { distance:  7.02, duration: '0:35:01' },
  '2026-06-03': { distance:  8.02, duration: '0:41:32' },
  '2026-06-02': { distance: 13.02, duration: '0:55:43' }, // fix broken "55:43:00" display
  '2026-06-01': { distance: 10.32, duration: '0:53:27' },
  '2026-05-30': { distance: 22.12, duration: '1:53:00' },
  '2026-05-29': { distance: 12.66, duration: '0:57:24' },
  '2026-05-27': { distance:  7.05, duration: '0:35:10' },
  '2026-05-26': { distance: 10.93, duration: '0:48:51' },
  '2026-05-23': { distance: 23.91, duration: '2:00:00' },
  '2026-05-22': { distance:  7.00, duration: '0:35:42' },
  '2026-05-21': { distance: 11.62, duration: '0:52:51' },
};

function die(msg) { console.error('Error:', msg); process.exit(1); }

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeJWT(clientEmail, privateKey) {
  const now     = Math.floor(Date.now() / 1000);
  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss:   clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   TOKEN_URL,
    exp:   now + 3600,
    iat:   now,
  }));
  const unsigned  = `${header}.${payload}`;
  const sign      = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${unsigned}.${signature}`;
}

function httpRequest(method, url, token, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const u    = new URL(url);
    const req  = https.request({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => (raw += c));
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
    const u    = new URL(url);
    const req  = https.request({
      hostname: u.hostname,
      path:     u.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let raw = '';
      res.on('data', c => (raw += c));
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

async function getAccessToken() {
  const raw = process.env.GOOGLE_SHEETS_KEY_JSON;
  if (!raw) die('GOOGLE_SHEETS_KEY_JSON is not set.');
  const key = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  const jwt = makeJWT(key.client_email, key.private_key);
  const res = await httpPostForm(TOKEN_URL, {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:  jwt,
  });
  if (res.status !== 200 || !res.body.access_token) {
    die(`Token request failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

async function main() {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) die('GOOGLE_SHEETS_ID is not set.');

  const token = await getAccessToken();

  const readUrl = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(`${TAB}!A:E`)}`;
  const readRes = await httpRequest('GET', readUrl, token);
  if (readRes.status !== 200) die(`Failed to read sheet: ${JSON.stringify(readRes.body)}`);

  const rows = readRes.body.values || [];
  const updates = [];
  const matched = new Set();
  const skipped = [];

  // Row 1 is the header; data rows are 2..N (1-indexed in A1 notation).
  for (let i = 1; i < rows.length; i++) {
    const date = rows[i][0];
    if (!BACKFILL[date]) continue;
    if (matched.has(date)) continue; // first match wins (top is newest)

    const existingDist = rows[i][3];
    const existingDur  = rows[i][4];
    const { distance, duration } = BACKFILL[date];

    // Only overwrite the cell if it's empty OR (for Jun 2) the malformed marker.
    // Avoid clobbering anything that was hand-corrected since.
    const distEmpty = existingDist == null || existingDist === '';
    const durEmpty  = existingDur  == null || existingDur  === '';
    const durBroken = date === '2026-06-02' && existingDur === '55:43:00';

    if (!distEmpty && !durEmpty && !durBroken) {
      skipped.push(`${date}: already has D=${existingDist}, E=${existingDur} — skipping`);
      matched.add(date);
      continue;
    }

    const rowNum = i + 1; // A1 notation is 1-indexed
    if (distEmpty) {
      updates.push({ range: `${TAB}!D${rowNum}`, values: [[distance]] });
    }
    if (durEmpty || durBroken) {
      updates.push({ range: `${TAB}!E${rowNum}`, values: [[duration]] });
    }
    matched.add(date);
  }

  const missing = Object.keys(BACKFILL).filter(d => !matched.has(d));
  if (missing.length) console.warn('No matching row in sheet for:', missing.join(', '));
  skipped.forEach(s => console.warn(s));

  if (!updates.length) {
    console.log('Nothing to update.');
    return;
  }

  console.log(`Updating ${updates.length} cells across ${matched.size} dates…`);
  const writeUrl = `${SHEETS_API}/${sheetId}/values:batchUpdate`;
  const writeRes = await httpRequest('POST', writeUrl, token, {
    valueInputOption: 'USER_ENTERED',
    data: updates,
  });
  if (writeRes.status !== 200) die(`Failed to write: ${JSON.stringify(writeRes.body)}`);
  console.log(`Updated ${writeRes.body.totalUpdatedCells} cells in ${writeRes.body.totalUpdatedRanges} ranges.`);
}

main().catch(e => die(e.message));
