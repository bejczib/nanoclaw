// Patch the morning coach task prompt with explicit log-recovery field names + stale-data guard.
const Database = require('better-sqlite3');
const db = new Database('store/messages.db');

const TASK_ID = 'task-coach-morning-6572975d734fc2a7';

const current = db.prepare('SELECT prompt FROM scheduled_tasks WHERE id = ?').get(TASK_ID);
if (!current) { console.error('Task not found'); process.exit(1); }

const oldStep6 = "6. Run: node ~/.claude/skills/sheets/sheets log-recovery with today's WHOOP data";

if (!current.prompt.includes(oldStep6)) {
  console.error('Could not find expected step 6 line to patch. Aborting (no change made).');
  console.error('Current prompt tail:');
  console.error(current.prompt.slice(-500));
  process.exit(1);
}

const newStep6 = `6. STALE-DATA GUARD: Before logging, fetch the most recent existing Recovery Trends row via 'node ~/.claude/skills/sheets/sheets' (or just check today's WHOOP output vs yesterday's). If today's HRV equals yesterday's exactly, the WHOOP cycle has not closed — DO NOT log and DO NOT send the recommendation message. Instead send a brief one-line note: "WHOOP cycle hasn't closed yet, I'll re-check at 09:30 local." Then stop.

   Otherwise, log recovery with EXACT field names (the script silently drops unknown fields):
   node ~/.claude/skills/sheets/sheets log-recovery '{
     "date": "<YYYY-MM-DD today>",
     "recovery_pct": <integer from WHOOP score.recovery_score>,
     "hrv": <number from score.hrv_rmssd_milli>,
     "rhr": <integer from score.resting_heart_rate>,
     "spo2": <number from score.spo2_percentage>,
     "strain": <number from cycle score.strain>,
     "sleep_score": <integer from sleep score.sleep_performance_percentage>,
     "sleep_duration": "<formatted Xh Ym>",
     "note": "<optional 1-line note>"
   }
   FIELD NAMES ARE LOAD-BEARING: recovery_pct (not recovery_score), sleep_score (not sleep_performance_percentage). Earlier versions of this task lost the Recovery %, Strain, and Sleep columns by passing WHOOP-native names — do not repeat that.`;

const newPrompt = current.prompt.replace(oldStep6, newStep6);

console.log('--- Old step 6 ---');
console.log(oldStep6);
console.log('\n--- New step 6 ---');
console.log(newStep6);

db.prepare('UPDATE scheduled_tasks SET prompt = ? WHERE id = ?').run(newPrompt, TASK_ID);
console.log('\n✓ Task prompt updated.');
