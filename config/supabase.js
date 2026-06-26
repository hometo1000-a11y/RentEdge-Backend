const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const localDbPath = path.join(__dirname, 'db.json');

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Helper functions for reading/writing local JSON database
function readLocalDb() {
  try {
    const data = fs.readFileSync(localDbPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading local db:', err);
    return { users: [], properties: [], tenants: [], leases: [], payments: [] };
  }
}

function writeLocalDb(data) {
  try {
    fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing local db:', err);
  }
}

// Check if a table exists in Supabase by running a dummy select
// PERFORMANCE: Cache results to avoid redundant queries on every db operation
const _tableExistsCache = {};
async function tableExists(tableName) {
  if (_tableExistsCache[tableName] !== undefined) return _tableExistsCache[tableName];
  try {
    const { error } = await supabase.from(tableName).select('id').limit(1);
    if (error && error.code === 'PGRST205') {
      _tableExistsCache[tableName] = false;
      return false;
    }
    if (error) {
      _tableExistsCache[tableName] = error.code !== 'PGRST205';
      return _tableExistsCache[tableName];
    }
    _tableExistsCache[tableName] = true;
    return true;
  } catch (err) {
    return false;
  }
}

const db = {
  async select(table, queryObj = {}, orderObj = null) {
    const useSupabase = await tableExists(table);
    if (useSupabase) {
      console.log(`[Supabase] SELECT from ${table}`);
      let query = supabase.from(table).select('*');
      for (const [key, val] of Object.entries(queryObj)) {
        query = query.eq(key, val);
      }
      if (orderObj) {
        query = query.order(orderObj.column, { ascending: orderObj.ascending });
      }
      const { data, error } = await query;
      if (!error) return data;
      console.error(`Supabase error select ${table}:`, error);
      throw error;
    }
    
    // Fallback to local db
    console.log(`[Local DB] SELECT from ${table}`);
    const local = readLocalDb();
    const records = local[table] || [];
    let results = records.filter(item => {
      for (const [key, val] of Object.entries(queryObj)) {
        if (item[key] !== val) return false;
      }
      return true;
    });
    
    if (orderObj) {
      results.sort((a, b) => {
        if (a[orderObj.column] < b[orderObj.column]) return orderObj.ascending ? -1 : 1;
        if (a[orderObj.column] > b[orderObj.column]) return orderObj.ascending ? 1 : -1;
        return 0;
      });
    }
    return results;
  },

  async selectFirst(table, queryObj = {}) {
    const results = await this.select(table, queryObj);
    return results[0] || null;
  },

  async insert(table, dataObj) {
    const useSupabase = await tableExists(table);
    if (useSupabase) {
      console.log(`[Supabase] INSERT into ${table}`);
      const { data, error } = await supabase.from(table).insert([dataObj]).select();
      if (!error && data && data.length > 0) return data[0];
      console.error(`Supabase error insert ${table}:`, error);
      throw error;
    }

    // Fallback to local db
    console.log(`[Local DB] INSERT into ${table}`);
    const local = readLocalDb();
    if (!local[table]) local[table] = [];
    
    const record = { ...dataObj };
    if (!record.id) {
      record.id = table.substring(0, 4) + '-' + Math.random().toString(36).substr(2, 9);
    }
    local[table].push(record);
    writeLocalDb(local);
    return record;
  },

  async update(table, id, dataObj) {
    const useSupabase = await tableExists(table);
    if (useSupabase) {
      console.log(`[Supabase] UPDATE ${table} (id: ${id})`);
      const { data, error } = await supabase.from(table).update(dataObj).eq('id', id).select();
      if (!error && data && data.length > 0) return data[0];
      console.error(`Supabase error update ${table}:`, error);
      throw error;
    }

    // Fallback to local db
    console.log(`[Local DB] UPDATE ${table} (id: ${id})`);
    const local = readLocalDb();
    const records = local[table] || [];
    const index = records.findIndex(item => item.id === id);
    if (index === -1) return null;

    records[index] = { ...records[index], ...dataObj };
    local[table] = records;
    writeLocalDb(local);
    return records[index];
  },

  async delete(table, id) {
    const useSupabase = await tableExists(table);
    if (useSupabase) {
      console.log(`[Supabase] DELETE ${table} (id: ${id})`);
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (!error) return true;
      console.error(`Supabase error delete ${table}:`, error);
      throw error;
    }

    // Fallback to local db
    console.log(`[Local DB] DELETE ${table} (id: ${id})`);
    const local = readLocalDb();
    const records = local[table] || [];
    const index = records.findIndex(item => item.id === id);
    if (index === -1) return false;

    records.splice(index, 1);
    local[table] = records;
    writeLocalDb(local);
    return true;
  }
};

module.exports = {
  supabase,
  db
};
