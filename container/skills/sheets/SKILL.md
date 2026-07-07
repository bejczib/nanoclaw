---
name: sheets
description: Read and write coaching data to Google Sheets — log workouts, weekly plans, and recovery trends. Use after analyzing Strava/WHOOP data to persist structured records.
allowed-tools: Bash(node:*)
---

# Google Sheets — Coaching Log

Persist coaching data across three tabs: Weekly Plans, Workout Log, Recovery Trends.

## Quick start

```bash
node ~/.claude/skills/sheets/sheets init
node ~/.claude/skills/sheets/sheets get-plan
node ~/.claude/skills/sheets/sheets get-workouts --days 7
```

## Commands

### Initialize spreadsheet
```bash
node ~/.claude/skills/sheets/sheets init
```
Creates the three tabs with headers if they don't already exist. Run once after setup.

### Log a completed workout
```bash
node ~/.claude/skills/sheets/sheets log-workout '<json>'
```
Appends one row to the Workout Log tab.

**JSON fields:**
```json
{
  "date": "2026-05-05",
  "sport": "Run",
  "planned": "12km @ 4:00/km tempo",
  "actual_distance": 12.1,
  "actual_duration": "48:22",
  "avg_hr": 162,
  "avg_pace": "4:00/km",
  "recovery_pct": 74,
  "hrv": 58,
  "suffer_score": 65,
  "status": "hit",
  "notes": "Felt strong, last 2km drifted to 3:58"
}
```
`status` values: `hit` / `strong` / `missed` / `weak` / `partial`

### Log a weekly plan
```bash
node ~/.claude/skills/sheets/sheets log-plan '<json>'
```
Appends one row to the Weekly Plans tab. Call this every Monday when generating the week's plan.

**JSON fields:**
```json
{
  "week_start": "2026-05-04",
  "week_num": 2,
  "phase": "Build 1",
  "mon": "8km easy",
  "tue": "7km @ 4:03 tempo",
  "wed": "10km easy",
  "thu": "6x1km @ 3:30",
  "fri": "6km easy",
  "sat": "24km long run",
  "sun": "rest",
  "volume_target": 70,
  "coach_notes": "First quality week of Build 1. Focus: tempo execution."
}
```

### Log a recovery snapshot
```bash
node ~/.claude/skills/sheets/sheets log-recovery '<json>'
```
Appends one row to the Recovery Trends tab. Call as part of the morning check-in.

**JSON fields:**
```json
{
  "date": "2026-05-05",
  "recovery_pct": 74,
  "hrv": 58,
  "rhr": 48,
  "spo2": 98,
  "strain": 12.4,
  "sleep_score": 82,
  "sleep_duration": "7h 42m",
  "note": "Good recovery after Tuesday tempo"
}
```

### Log a fitness snapshot
```bash
node ~/.claude/skills/sheets/sheets log-fitness '<json>'
```
Appends one row to the Fitness Trend tab. Call after every Race or Tempo effort.

**JSON fields:**
```json
{
  "date": "2026-04-22",
  "vdot": 57.8,
  "effort_type": "Tempo",
  "distance": 10.1,
  "time": "41:30",
  "pace": "4:06/km",
  "avg_hr": 162,
  "ae_index": 1.49,
  "hrv_7d": 55.2,
  "volume_28d": 68,
  "notes": "Solid tempo — negative split, HR controlled"
}
```
`effort_type` values: `Race` / `Tempo` / `Long` / `Easy`

VDOT is only meaningful for Race/Tempo efforts. AE Index = running speed (m/min) / avg_hr × 100 — higher means more aerobically efficient.

### Write a coach note for a workout
```bash
node ~/.claude/skills/sheets/sheets coach-note '<json>'
```
Finds the workout row for the given date and writes a coach evaluation to the Coach Note column. Call after every evening workout analysis.

**JSON fields:**
```json
{
  "date": "2026-04-22",
  "note": "On target — tempo splits held within 3 sec/km, HR stable. AE index up vs 4 weeks ago. Moving in the right direction."
}
```

### Backfill fitness history (one-time)
```bash
node ~/.claude/skills/sheets/sheets backfill-fitness
```
Fetches all running activities from Strava (2024-01-01 → today) and WHOOP recovery data, computes VDOT + AE Index + rolling 7d HRV + 28d volume for each run, and populates the Fitness Trend tab. Idempotent — skips dates already present.

### Read fitness trend
```bash
node ~/.claude/skills/sheets/sheets get-fitness
node ~/.claude/skills/sheets/sheets get-fitness --days 90
```
Returns recent fitness trend rows with VDOT range and trend summary (default: 90 days).

### Read current week's plan
```bash
node ~/.claude/skills/sheets/sheets get-plan
node ~/.claude/skills/sheets/sheets get-plan --week 2026-05-04
```
Returns the plan row for the given week (defaults to current Monday).

### Read recent workouts
```bash
node ~/.claude/skills/sheets/sheets get-workouts
node ~/.claude/skills/sheets/sheets get-workouts --days 14
```
Returns all logged workouts from the last N days (default: 7).

## Spreadsheet tabs

**Weekly Plans** — one row per week
`Week Start | Week # | Phase | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Volume Target | Coach Notes`

**Workout Log** — one row per completed workout
`Date | Day | Sport | Planned Session | Actual Distance | Actual Duration | Avg HR | Avg Pace/Power | Recovery % | HRV | Suffer Score | Status | Notes`

**Recovery Trends** — one row per day (morning)
`Date | Recovery % | HRV | RHR | SpO2 | Strain | Sleep Score | Sleep Duration | Coach Note`

**Fitness Trend** — one row per notable run (Race, Tempo, Long, Easy)
`Date | VDOT | Effort Type | Distance (km) | Time | Pace (/km) | Avg HR | AE Index | 7d Avg HRV | 28d Volume (km) | Notes`

- **VDOT**: Jack Daniels formula — only populated for Race/Tempo efforts
- **AE Index**: Aerobic Efficiency = speed (m/min) / avg_hr × 100. Rising AE = improving fitness even at same HR
- **7d Avg HRV**: Rolling 7-day average HRV from WHOOP at time of run
- **28d Volume**: Total running km over the 28 days ending on this date

## Setup

Requires two environment variables in `.env` (or OneCLI vault):

```
GOOGLE_SHEETS_KEY_JSON=<base64-encoded service account JSON>
GOOGLE_SHEETS_ID=<spreadsheet ID from the URL>
```

### One-time setup steps

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use existing)
3. Enable the **Google Sheets API**
4. Create a **Service Account** → download the JSON key
5. Base64-encode the key: `base64 -i service-account.json | tr -d '\n'`
6. Add to `.env`: `GOOGLE_SHEETS_KEY_JSON=<output from above>`
7. Create a new Google Sheet
8. Share it with the service account email (from the JSON, `client_email` field) as **Editor**
9. Copy the spreadsheet ID from the URL (`/spreadsheets/d/<ID>/edit`) → add to `.env`: `GOOGLE_SHEETS_ID=<ID>`
10. Run `node ~/.claude/skills/sheets/sheets init` to create tabs

## Notes

- Access token is cached at `/workspace/group/.sheets-tokens.json` (container) or `store/.sheets-tokens.json` (host) — valid for 1 hour, auto-refreshed
- All writes use `USER_ENTERED` input mode — Google Sheets will format dates and numbers correctly
- `log-workout` should be called after every post-workout feedback session
- `log-plan` should be called every Monday as part of the weekly planning task
- `log-recovery` should be called every morning as part of the morning check-in task
