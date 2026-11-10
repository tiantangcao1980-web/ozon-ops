import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('db/ozon.db');
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((row) => row.name);
console.log('tables:', tables.join(', '));
for (const table of tables) {
  const count = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  console.log(`${table}: ${count}`);
}
