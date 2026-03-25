import { createClient } from '@libsql/client';

let _client = null;

export function getDb() {
  if (_client) return _client;

  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error('TURSO_DATABASE_URL is not set');
  }

  _client = createClient({
    url:       process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return _client;
}

/** LibSQL rows can be array-like or driver-specific objects; JSON and app code expect plain column-keyed objects. */
function rowToPlainObject(row, columns) {
  if (row == null) return null;
  const o = {};
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (!col) continue;
    let v = row[col];
    if (v === undefined) v = row[i];
    o[col] = typeof v === 'bigint' ? Number(v) : v;
  }
  return o;
}

// Convenience: run a query and return all rows
export async function query(sql, args = []) {
  const db = getDb();
  const result = await db.execute({ sql, args });
  const columns = result.columns ?? [];
  return (result.rows ?? []).map((row) => rowToPlainObject(row, columns));
}

// Convenience: run a query and return first row or null
export async function queryOne(sql, args = []) {
  const rows = await query(sql, args);
  return rows[0] ?? null;
}

// Convenience: run a write (INSERT / UPDATE / DELETE)
export async function execute(sql, args = []) {
  const db = getDb();
  return await db.execute({ sql, args });
}
