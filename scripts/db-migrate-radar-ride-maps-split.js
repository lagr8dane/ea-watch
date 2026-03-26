#!/usr/bin/env node
// Adds interest_radar_ride_provider (uber|lyft) and interest_radar_maps_provider (google_maps|apple_maps).
// Backfills from legacy interest_radar_ride_handoff when that column exists.
// Usage: node --env-file=.env scripts/db-migrate-radar-ride-maps-split.js

import { createClient } from '@libsql/client';

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function addColumn(sql, name) {
  try {
    await db.execute(sql);
    console.log(`  ✓  ${name} added`);
  } catch (err) {
    if (String(err.message).includes('duplicate column')) {
      console.log(`  ✓  ${name} already exists`);
    } else {
      console.error(`  ✗  ${name}:`, err.message);
      throw err;
    }
  }
}

async function migrate() {
  console.log('EA Watch — radar ride + maps provider split');
  await addColumn(
    `ALTER TABLE owner_config ADD COLUMN interest_radar_ride_provider TEXT`,
    'interest_radar_ride_provider'
  );
  await addColumn(
    `ALTER TABLE owner_config ADD COLUMN interest_radar_maps_provider TEXT`,
    'interest_radar_maps_provider'
  );

  try {
    await db.execute(`
      UPDATE owner_config SET
        interest_radar_ride_provider = 'uber',
        interest_radar_maps_provider = CASE
          WHEN IFNULL(interest_radar_ride_handoff, '') = 'apple_maps' THEN 'apple_maps'
          ELSE 'google_maps'
        END
      WHERE interest_radar_ride_provider IS NULL
         OR TRIM(COALESCE(interest_radar_ride_provider, '')) = ''
    `);
    console.log('  ✓  Backfilled from interest_radar_ride_handoff (if column existed)');
  } catch (err) {
    if (String(err.message).includes('no such column')) {
      await db.execute(`
        UPDATE owner_config SET
          interest_radar_ride_provider = 'uber',
          interest_radar_maps_provider = 'google_maps'
        WHERE interest_radar_ride_provider IS NULL
           OR TRIM(COALESCE(interest_radar_ride_provider, '')) = ''
      `);
      console.log('  ✓  Defaults set (no legacy handoff column)');
    } else {
      throw err;
    }
  }

  console.log('Done.');
  process.exit(0);
}

migrate().catch(() => process.exit(1));
