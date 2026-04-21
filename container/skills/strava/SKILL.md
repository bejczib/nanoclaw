---
name: strava
description: Fetch Strava workouts and training data — activities, distances, pace, heart rate, elevation, and athlete stats. Use when the user asks about their workouts, runs, rides, swims, training, or Strava data.
allowed-tools: Bash(node:*)
---

# Strava Training Data

Fetch workout activities and training stats from Strava.

## Quick start

```bash
node ~/.claude/skills/strava/strava today
node ~/.claude/skills/strava/strava date 2025-01-15
node ~/.claude/skills/strava/strava range 2025-01-01 2025-01-31
node ~/.claude/skills/strava/strava recent --days 14
node ~/.claude/skills/strava/strava athlete
```

## Commands

### Today's activities
```bash
node ~/.claude/skills/strava/strava today
```
All activities logged today.

### Specific date
```bash
node ~/.claude/skills/strava/strava date YYYY-MM-DD
```
All activities on a given date.

### Date range
```bash
node ~/.claude/skills/strava/strava range YYYY-MM-DD YYYY-MM-DD
```
All activities in a period. Includes a summary (count, distance, time) grouped by sport.

### Recent activities
```bash
node ~/.claude/skills/strava/strava recent [--days N]   # default: 7
```
Activities from the last N days with a total summary.

### Athlete profile & stats
```bash
node ~/.claude/skills/strava/strava athlete
```
Profile info plus YTD and all-time totals for run, ride, and swim.

## What the data means

**Distance** — meters internally, displayed in km (≥ 1 km) or m.

**Moving time** — excludes stopped time (e.g. traffic lights).

**Pace** — min/km for runs/walks/hikes; km/h for rides.

**Elevation gain** — total ascent in meters.

**Heart rate** — average and max bpm (only available if recorded by a device).

**Power** — watts average (cycling with a power meter only).

**Suffer score** — Strava's relative effort metric (higher = harder session).

**Sport types** — Run, Ride, Swim, Walk, Hike, VirtualRide, WeightTraining, Workout, Yoga, and many others.

## Trigger phrases

Use this skill when the user says things like:
- "How was my run today?" / "Did I work out?"
- "Show my recent workouts" / "What did I do this week?"
- "How many km did I run this month?"
- "What's my YTD mileage?" / "All-time stats"
- "Show my Strava data" / "Training history"
- "How was my ride on Tuesday?"
- "What's my best pace recently?"

## Notes

- Activities are returned newest-first
- The script automatically refreshes the OAuth access token using the stored refresh token
- Token cache is stored at `/workspace/group/.strava-tokens.json`
- If credentials are missing, tell the user to run `node scripts/strava-setup` on the host machine
