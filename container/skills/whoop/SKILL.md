---
name: whoop
description: Fetch WHOOP health data — recovery, sleep, strain, workouts, and body metrics. Use when the user asks about their health, recovery, sleep, HRV, or workout data.
allowed-tools: Bash(node:*)
---

# WHOOP Health Data

Fetch recovery, sleep, strain, and workout data from the WHOOP API.

## Quick start

```bash
node ~/.claude/skills/whoop/whoop today
node ~/.claude/skills/whoop/whoop date 2025-01-15
node ~/.claude/skills/whoop/whoop range 2025-01-01 2025-01-31
node ~/.claude/skills/whoop/whoop profile
```

## Commands

### Today's snapshot
```bash
node ~/.claude/skills/whoop/whoop today
```
Returns recovery score, sleep summary, strain, and any logged workouts for today's cycle.

### Specific date
```bash
node ~/.claude/skills/whoop/whoop date YYYY-MM-DD
```
Full snapshot for a given date.

### Date range
```bash
node ~/.claude/skills/whoop/whoop range YYYY-MM-DD YYYY-MM-DD
```
All data across a period. Great for weekly or monthly reviews.

### Individual metrics with custom look-back
```bash
node ~/.claude/skills/whoop/whoop recovery [--days N]   # default: 7
node ~/.claude/skills/whoop/whoop sleep    [--days N]
node ~/.claude/skills/whoop/whoop strain   [--days N]
node ~/.claude/skills/whoop/whoop workout  [--days N]
```

### Profile & body measurements
```bash
node ~/.claude/skills/whoop/whoop profile
```

## What the data means

**Recovery (0–100%)**
- Green (67–100%): Well-recovered, ready for high strain
- Yellow (34–66%): Moderate — light/moderate activity recommended
- Red (0–33%): Poor — rest or very light activity

**Key recovery metrics**
- `hrv_rmssd_milli` — Heart rate variability (higher = more recovered)
- `resting_heart_rate` — Lower resting HR generally means better recovery
- `spo2_percentage` — Blood oxygen (normal 95–100%)
- `skin_temp_celsius` — Deviation from baseline (elevation may indicate stress/illness)

**Strain (0–21 scale)**
- 0–9: Light day
- 10–13: Moderate
- 14–17: Strenuous
- 18–21: All out

**Sleep score (0–100%)**
- Sleep performance compares actual sleep to the recommended amount
- Stage breakdown: Light, REM, Deep (slow-wave)

## Trigger phrases

Use this skill when the user says things like:
- "How did I sleep?" / "What's my sleep score?"
- "What's my recovery today?" / "How recovered am I?"
- "What's my HRV?" / "Resting heart rate?"
- "How was my strain this week?"
- "Show me my WHOOP data"
- "Did I work out?" / "Show my workouts"
- "How have I been feeling / recovering lately?"

## Notes

- Data for "today" covers the current physiological cycle (may include yesterday's sleep)
- The script automatically refreshes the OAuth access token using the stored refresh token
- Token cache is stored at `/workspace/group/.whoop-tokens.json`
- If credentials are missing, tell the user to run `scripts/whoop-setup` on the host machine
