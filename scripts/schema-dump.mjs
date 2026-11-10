import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('db/ozon.db');
for (const table of ['sku_costs', 'stocks', 'prices', 'analytics_daily', 'postings', 'products']) {
  const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table)?.sql ?? '(missing)';
  console.log(`${table}:\n${sql}\n`);
}
