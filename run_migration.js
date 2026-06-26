const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const runMigration = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Connected to database.');

    const sqlPath = path.join(__dirname, 'migrations', '017_tenant_discovery.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Running migration 017_tenant_discovery.sql...');
    await client.query(sql);
    console.log('Migration successful!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
};

runMigration();
