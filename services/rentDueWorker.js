/**
 * Rent Due Worker — Indian Monthly Rent Cycle Automation
 * 
 * Runs every hour (and once on startup) to mark rent as 'due'
 * for active tenants whose next_due_date has arrived.
 * 
 * This worker is completely independent from API requests.
 * It does NOT use database realtime listeners, webhooks, or polling loops.
 */

const { supabase } = require('../config/supabase');

// ─── Date Calculation ─────────────────────────────────────────────
/**
 * Calculate the next rent due date based on the Indian rent cycle model.
 * 
 * Rules:
 * 1. Move to the next calendar month from currentDueDate.
 * 2. Attempt to use billingDay as the day of that month.
 * 3. If billingDay exceeds the last day of the target month,
 *    clamp to the last day (e.g., billing_day=31 in Feb → 28th).
 * 4. The billing_day is NEVER mutated — it always attempts to return
 *    to the original day in subsequent months.
 * 
 * @param {number} billingDay - The permanent billing day (1–31). Never changes.
 * @param {Date|string} currentDueDate - The current next_due_date.
 * @returns {string} ISO date string (YYYY-MM-DD) for the next due date.
 */
function calculateNextDueDate(billingDay, currentDueDate) {
  // Parse date string directly to avoid timezone issues
  // Input format: 'YYYY-MM-DD'
  const parts = String(currentDueDate).split('T')[0].split('-');
  const currentYear = parseInt(parts[0], 10);
  const currentMonth = parseInt(parts[1], 10); // 1-indexed (1=Jan, 12=Dec)
  
  let targetMonth = currentMonth + 1;
  let targetYear = currentYear;
  
  if (targetMonth > 12) {
    targetMonth = 1;
    targetYear += 1;
  }
  
  // Get the last day of the target month
  // new Date(year, month, 0) gives last day of (month-1), so we use month directly
  // since targetMonth is 1-indexed, new Date(year, targetMonth, 0) gives last day of targetMonth
  const lastDayOfTarget = new Date(targetYear, targetMonth, 0).getDate();
  
  // Clamp billing day to last day of target month
  const actualDay = Math.min(billingDay, lastDayOfTarget);
  
  // Format as YYYY-MM-DD without using toISOString (avoids timezone shift)
  const yyyy = String(targetYear);
  const mm = String(targetMonth).padStart(2, '0');
  const dd = String(actualDay).padStart(2, '0');
  
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calculates the previous due date correctly handling varying month lengths
 * 
 * @param {number} billingDay - The permanent billing day (1–31)
 * @param {Date|string} currentDueDate - The current next_due_date
 * @returns {string} ISO date string (YYYY-MM-DD) for the previous due date
 */
function calculatePreviousDueDate(billingDay, currentDueDate) {
  const parts = String(currentDueDate).split('T')[0].split('-');
  const currentYear = parseInt(parts[0], 10);
  const currentMonth = parseInt(parts[1], 10);
  
  let targetMonth = currentMonth - 1;
  let targetYear = currentYear;
  
  if (targetMonth < 1) {
    targetMonth = 12;
    targetYear -= 1;
  }
  
  const lastDayOfTarget = new Date(targetYear, targetMonth, 0).getDate();
  const actualDay = Math.min(billingDay, lastDayOfTarget);
  
  const yyyy = String(targetYear);
  const mm = String(targetMonth).padStart(2, '0');
  const dd = String(actualDay).padStart(2, '0');
  
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Worker Execution ─────────────────────────────────────────────
/**
 * Scans all active tenants and marks rent_status = 'due'
 * for any tenant whose next_due_date <= today AND rent_status != 'due'.
 * 
 * Ignores:
 * - status != 'active'
 * - left_at IS NOT NULL
 * - next_due_date IS NULL (legacy tenants without rent cycle setup)
 */
async function runRentDueCheck() {
  const now = new Date();
  const todayISO = now.toISOString().split('T')[0]; // YYYY-MM-DD
  
  console.log(`[RentDueWorker] ⏰ Running rent due check at ${now.toISOString()} (today = ${todayISO})`);
  
  try {
    // Find all active tenants whose rent is not yet marked 'due'
    // but whose next_due_date has arrived (or passed)
    const { data: dueTenants, error: fetchError } = await supabase
      .from('property_tenants')
      .select('id, tenant_id, property_id, billing_day, next_due_date, rent_status')
      .eq('status', 'active')
      .is('left_at', null)
      .not('next_due_date', 'is', null)
      .lte('next_due_date', todayISO)
      .neq('rent_status', 'due');
    
    if (fetchError) {
      console.error('[RentDueWorker] ✘ Query error:', fetchError.message);
      return;
    }
    
    if (!dueTenants || dueTenants.length === 0) {
      console.log('[RentDueWorker] ✓ No tenants require rent status update.');
      return;
    }
    
    console.log(`[RentDueWorker] Found ${dueTenants.length} tenant(s) with rent now due.`);
    
    // Update each tenant's rent_status to 'due'
    const ids = dueTenants.map(t => t.id);
    const { error: updateError, count } = await supabase
      .from('property_tenants')
      .update({ rent_status: 'due' })
      .in('id', ids);
    
    if (updateError) {
      console.error('[RentDueWorker] ✘ Update error:', updateError.message);
      return;
    }
    
    console.log(`[RentDueWorker] ✓ Marked ${ids.length} tenant(s) as rent 'due'.`);
    dueTenants.forEach(t => {
      console.log(`  → Tenant ${t.id} | next_due_date=${t.next_due_date} | billing_day=${t.billing_day}`);
    });
    
  } catch (err) {
    console.error('[RentDueWorker] ✘ Unexpected error:', err);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────
const ONE_HOUR_MS = 60 * 60 * 1000;

function startRentDueWorker() {
  console.log('[RentDueWorker] 🚀 Worker initialized. Running initial check...');
  
  // Run immediately on startup (covers server downtime recovery)
  runRentDueCheck();
  
  // Then run every hour
  setInterval(runRentDueCheck, ONE_HOUR_MS);
  
  console.log(`[RentDueWorker] ⏱ Scheduled to run every ${ONE_HOUR_MS / 60000} minutes.`);
}

// ─── Exports ──────────────────────────────────────────────────────
module.exports = {
  runRentDueCheck,
  calculateNextDueDate,
  calculatePreviousDueDate,
  startRentDueWorker
};
