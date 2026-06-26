/**
 * RentEdge — Migration Runner
 * 
 * Usage:  node setupDB.js
 * 
 * Connects directly to PostgreSQL using DATABASE_URL and executes
 * migration files from the /migrations directory.
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ Missing DATABASE_URL in .env');
  console.error('   Example: postgresql://postgres:[YOUR-PASSWORD]@db.urwfmvmrwjrbkbulosoi.supabase.co:5432/postgres');
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
});

async function runMigrations() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    RentEdge — Database Migration Runner      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  
  try {
    await client.connect();
    console.log('✅ Connected to database.');

    // Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('⚠️  Migrations directory not found. Creating it...');
      fs.mkdirSync(migrationsDir);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Sorts files alphabetically (e.g. 001_..., 002_...)

    if (files.length === 0) {
      console.log('   No migration files found in /migrations.');
      return;
    }

    // Get applied migrations
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const appliedMigrations = new Set(rows.map(r => r.version));

    let executedCount = 0;

    for (const file of files) {
      if (!appliedMigrations.has(file)) {
        console.log(`⏳ Applying migration: ${file}...`);
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');

        // Execute migration in a transaction
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`✅ Successfully applied: ${file}`);
          executedCount++;
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`❌ Error applying migration ${file}:`, err.message);
          throw err; // Stop executing further migrations on error
        }
      } else {
        console.log(`⏭️  Skipping ${file} (already applied)`);
      }
    }

    if (executedCount === 0) {
      console.log('✨ Database is already up to date.');
    } else {
      console.log(`✨ Successfully executed ${executedCount} new migration(s).`);
    }

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

runMigrations();
