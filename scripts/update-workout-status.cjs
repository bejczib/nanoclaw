#!/usr/bin/env node
// One-off: update Status column (H) for a Workout Log row by date.
// Usage: node scripts/update-workout-status.cjs YYYY-MM-DD <status>

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

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TAB = 'Workout Log';

function httpRequest(method, url, token, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
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

async function getToken() {
  const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SHEETS_KEY_JSON, 'base64').toString());
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const jwtBody = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  })).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${jwtHeader}.${jwtBody}`);
  const sig = signer.sign(sa.private_key).toString('base64url');
  const jwt = `${jwtHeader}.${jwtBody}.${sig}`;

  const form = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
  const res = await new Promise((resolve, reject) => {
    const u = new URL('https://oauth2.googleapis.com/token');
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) },
    }, r => {
      let raw = ''; r.on('data', c => (raw += c));
      r.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject); req.write(form); req.end();
  });
  return res.access_token;
}

(async () => {
  const [date, status] = process.argv.slice(2);
  if (!date || !status) { console.error('Usage: update-workout-status.cjs YYYY-MM-DD <status>'); process.exit(1); }

  const token = await getToken();
  const sheetId = process.env.GOOGLE_SHEETS_ID;

  const range = encodeURIComponent(`${TAB}!A2:A`);
  const r = await httpRequest('GET', `${SHEETS_API}/${sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`, token);
  const rows = (r.body.values || []);
  const idx = rows.findIndex(row => row[0] === date);
  if (idx < 0) { console.error(`No row for ${date}`); process.exit(1); }
  const rowNum = idx + 2;

  const writeRange = encodeURIComponent(`${TAB}!H${rowNum}`);
  const w = await httpRequest('PUT', `${SHEETS_API}/${sheetId}/values/${writeRange}?valueInputOption=RAW`, token, { values: [[status]] });
  if (w.status !== 200) { console.error(`Failed: ${JSON.stringify(w.body)}`); process.exit(1); }
  console.log(`✓ Updated status for ${date} (row ${rowNum}) -> ${status}`);
})();
