import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS products (
        product_id INTEGER PRIMARY KEY,
        offer_id TEXT,
        sku INTEGER,
        name TEXT,
        category_id INTEGER,
        archived INTEGER DEFAULT 0,
        has_fbs_stocks INTEGER DEFAULT 0,
        has_fbo_stocks INTEGER DEFAULT 0,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS prices (
        sku INTEGER NOT NULL,
        offer_id TEXT,
        price_cny REAL,
        old_price_cny REAL,
        marketing_price_cny REAL,
        min_price_cny REAL,
        currency TEXT,
        commission_rate REAL,
        acquiring_rate REAL,
        price_index_color TEXT,
        volume_weight REAL,
        commissions_json TEXT,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (sku, captured_at)
      );

      CREATE TABLE IF NOT EXISTS stocks (
        sku INTEGER NOT NULL,
        warehouse_id INTEGER NOT NULL DEFAULT 0,
        warehouse_name TEXT,
        present INTEGER,
        reserved INTEGER,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (sku, warehouse_id, captured_at)
      );

      CREATE TABLE IF NOT EXISTS postings (
        posting_number TEXT PRIMARY KEY,
        order_number TEXT,
        status TEXT,
        substatus TEXT,
        created_at TEXT,
        in_process_at TEXT,
        shipment_date TEXT,
        price_rub REAL,
        currency TEXT,
        pending_shipment INTEGER DEFAULT 0,
        items_json TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS analytics_daily (
        date TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        ordered_units INTEGER,
        revenue_rub REAL,
        delivered_units INTEGER,
        returns INTEGER,
        hits_view INTEGER,
        hits_view_search INTEGER,
        hits_view_pdp INTEGER,
        hits_tocart_search INTEGER,
        hits_tocart_pdp INTEGER,
        session_view_pdp INTEGER,
        conv_tocart_pdp REAL,
        position_category REAL,
        captured_at TEXT,
        PRIMARY KEY (date, sku)
      );

      CREATE TABLE IF NOT EXISTS rating_snapshot (
        captured_at TEXT PRIMARY KEY,
        groups_json TEXT
      );

      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        niche TEXT NOT NULL,
        ru_query TEXT,
        evidence_json TEXT,
        score REAL,
        verdict TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sku_costs (
        offer_id TEXT PRIMARY KEY,
        purchase_cny REAL,
        domestic_freight_cny REAL,
        packaging_cny REAL,
        weight_g REAL,
        dims_cm TEXT,
        supplier TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS listing_drafts (
        offer_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT,
        qa_json TEXT,
        status TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (offer_id, version)
      );

      CREATE TABLE IF NOT EXISTS actions_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target TEXT,
        payload_json TEXT,
        risk TEXT,
        status TEXT NOT NULL,
        code TEXT,
        executed_by TEXT,
        executed_at TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        status INTEGER,
        ms INTEGER,
        bytes INTEGER,
        error TEXT,
        called_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS fx_rates (
        date TEXT PRIMARY KEY,
        rub_per_cny REAL NOT NULL,
        source TEXT,
        captured_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_prices_offer ON prices(offer_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_daily(date);
      CREATE INDEX IF NOT EXISTS idx_api_calls_called ON api_calls(called_at);
    `,
  },
  {
    version: 2,
    sql: `ALTER TABLE candidates ADD COLUMN spec_json TEXT;`,
  },
  {
    version: 3,
    sql: `ALTER TABLE postings ADD COLUMN amount_total REAL;
          ALTER TABLE postings ADD COLUMN amount_currency TEXT;`,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS competitors (
        sku TEXT PRIMARY KEY,
        title TEXT,
        seller TEXT,
        url TEXT,
        price_rub REAL,
        old_price_rub REAL,
        discount_pct REAL,
        rating REAL,
        reviews INTEGER,
        keyword TEXT,
        first_seen TEXT,
        last_seen TEXT
      );

      CREATE TABLE IF NOT EXISTS competitor_snapshots (
        sku TEXT NOT NULL,
        keyword TEXT,
        price_rub REAL,
        rating REAL,
        reviews INTEGER,
        stock_hint TEXT,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (sku, captured_at)
      );

      CREATE TABLE IF NOT EXISTS reviews_raw (
        review_id TEXT PRIMARY KEY,
        sku TEXT NOT NULL,
        rating REAL,
        text TEXT,
        published_at TEXT,
        has_photo INTEGER DEFAULT 0,
        source_url TEXT,
        captured_at TEXT
      );

      CREATE TABLE IF NOT EXISTS social_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        channel TEXT,
        text TEXT,
        published_at TEXT,
        url TEXT NOT NULL UNIQUE,
        engagement_json TEXT,
        captured_at TEXT
      );

      CREATE TABLE IF NOT EXISTS demand_signals (
        keyword TEXT NOT NULL,
        source TEXT NOT NULL,
        volume INTEGER,
        captured_at TEXT NOT NULL,
        raw_json TEXT,
        PRIMARY KEY (keyword, source, captured_at)
      );

      CREATE TABLE IF NOT EXISTS pain_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        niche TEXT NOT NULL,
        theme TEXT NOT NULL,
        count INTEGER,
        sample_reviews_json TEXT,
        generated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_reviews_sku ON reviews_raw(sku);
      CREATE INDEX IF NOT EXISTS idx_competitors_keyword ON competitors(keyword);
      CREATE INDEX IF NOT EXISTS idx_social_source ON social_posts(source, published_at);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS competitor_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL,
        url TEXT NOT NULL,
        role TEXT,
        position INTEGER,
        width INTEGER,
        height INTEGER,
        captured_at TEXT NOT NULL,
        UNIQUE (sku, url, captured_at)
      );

      CREATE TABLE IF NOT EXISTS design_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL,
        palette_json TEXT,
        blocks_json TEXT,
        notes TEXT,
        captured_at TEXT NOT NULL,
        UNIQUE (sku, captured_at)
      );

      CREATE INDEX IF NOT EXISTS idx_competitor_images_sku ON competitor_images(sku);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS ads_daily (
        date TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        impressions INTEGER,
        clicks INTEGER,
        spend_rub REAL,
        orders INTEGER,
        revenue_rub REAL,
        captured_at TEXT,
        PRIMARY KEY (date, campaign_id)
      );
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE actions_log ADD COLUMN items INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE analytics_daily ADD COLUMN currency TEXT NOT NULL DEFAULT 'RUB';
      ALTER TABLE prices ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'CNY';
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE IF NOT EXISTS intel_items (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        category TEXT NOT NULL,
        lang TEXT,
        title TEXT NOT NULL,
        detail TEXT,
        url TEXT,
        importance INTEGER NOT NULL,
        credibility INTEGER NOT NULL,
        threat TEXT NOT NULL,
        published_at TEXT,
        captured_at TEXT NOT NULL,
        payload_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_intel_captured ON intel_items(captured_at);
      CREATE INDEX IF NOT EXISTS idx_intel_category ON intel_items(category);
    `,
  },
];

export function openDb({ filePath = ':memory:' } = {}) {
  const db = new DatabaseSync(filePath);

  function migrate() {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    for (const migration of MIGRATIONS) {
      // 在写事务里重新读版本：并发进程（定时任务 + 手动）不会各自应用同一迁移
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = Number(db.prepare('PRAGMA user_version').get().user_version ?? 0);
        if (migration.version <= current) {
          db.exec('COMMIT');
          continue;
        }
        db.exec(migration.sql);
        db.exec(`PRAGMA user_version = ${migration.version}`);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        // 另一进程已应用同一迁移（duplicate column）时视为成功
        const message = String(error?.message ?? error);
        if (/duplicate column name|already exists/i.test(message)) {
          const current = Number(db.prepare('PRAGMA user_version').get().user_version ?? 0);
          if (current >= migration.version) continue;
        }
        throw error;
      }
    }
  }

  function upsert(table, row, keys) {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    const updates = columns
      .filter((column) => !keys.includes(column))
      .map((column) => `${column} = excluded.${column}`)
      .join(', ');
    const conflict = keys.map((key) => `"${key}"`).join(', ');
    const sql = updates
      ? `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`
      : `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO NOTHING`;
    db.prepare(sql).run(...columns.map((column) => row[column]));
  }

  function setting(key, fallback = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  function setSetting(key, value) {
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(key, typeof value === 'string' ? value : JSON.stringify(value), new Date().toISOString());
  }

  return { db, migrate, close: () => db.close(), upsert, setting, setSetting };
}
