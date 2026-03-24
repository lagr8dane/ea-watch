#!/usr/bin/env node
// Inserts demo tasks (personal errands + weekend projects) for the first owner.
// Dates are relative to "today" in local time so overdue / today / later look realistic.
// Usage: node --env-file=.env scripts/db-seed-tasks-demo.js
//        node --env-file=.env scripts/db-seed-tasks-demo.js --force   # delete this owner's tasks first

import { createClient } from '@libsql/client';
import { v4 as uuidv4 } from 'uuid';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function dayKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const demoRows = [
  // errands — mix of overdue, today, soon
  { title: 'Pick up dry cleaning', due_at: dayKey(-2), priority: 'normal' },
  { title: 'Call dentist to reschedule checkup', due_at: dayKey(0), priority: 'high' },
  { title: 'Buy groceries — milk, eggs, coffee', due_at: dayKey(0), priority: 'normal' },
  { title: 'Pay parking ticket online', due_at: dayKey(1), priority: 'high' },
  { title: 'RSVP for Sam birthday dinner', due_at: dayKey(5), priority: 'normal' },
  { title: 'Drop package at UPS', due_at: dayKey(2), priority: 'low' },
  { title: 'Schedule oil change for the car', due_at: null, priority: 'normal' },
  // weekend warrior
  { title: 'Long run — 10 mi, easy pace', due_at: dayKey(4), priority: 'high' },
  { title: 'Bike tune-up: chain lube + tire pressure', due_at: dayKey(4), priority: 'normal' },
  { title: 'Touch up deck stain (south railing)', due_at: dayKey(5), priority: 'normal' },
  { title: 'Research hydration pack for trail runs', due_at: null, priority: 'low' },
  { title: 'Wash climbing shoes + air dry', due_at: dayKey(3), priority: 'low' },
  { title: 'Hit the climbing gym — project route', due_at: dayKey(4), priority: 'normal' },
  { title: 'Order mulch for side yard', due_at: dayKey(7), priority: 'low' },
];

async function main() {
  const r = await db.execute({ sql: 'SELECT id FROM owner_config LIMIT 1', args: [] });
  const ownerId = r.rows[0]?.id;
  if (!ownerId) {
    console.error('No owner_config row. Finish setup first.');
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  if (force) {
    await db.execute({ sql: 'DELETE FROM tasks WHERE owner_id = ?', args: [ownerId] });
    console.log('Cleared existing tasks for owner.');
  } else {
    const c = await db.execute({
      sql: 'SELECT COUNT(*) AS n FROM tasks WHERE owner_id = ?',
      args: [ownerId],
    });
    const r0 = c.rows[0];
    const n = Number(r0?.n ?? r0?.N ?? (r0 ? Object.values(r0)[0] : 0)) || 0;
    if (n > 0) {
      console.error(`Owner already has ${n} task(s). Re-run with --force to replace with demo data.`);
      process.exit(1);
    }
  }

  const t0 = ts();
  for (const row of demoRows) {
    const id = uuidv4();
    await db.execute({
      sql: `INSERT INTO tasks (id, owner_id, title, status, priority, due_at, created_at, updated_at)
            VALUES (?, ?, ?, 'open', ?, ?, ?, ?)`,
      args: [id, ownerId, row.title, row.priority, row.due_at, t0, t0],
    });
  }

  console.log(`Inserted ${demoRows.length} demo tasks for owner ${ownerId}. Open /tasks or say "my tasks" in EA.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
