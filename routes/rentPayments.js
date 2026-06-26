const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');
const { calculateNextDueDate } = require('../services/rentDueWorker');

// @route   POST /api/rent-payments
// @desc    Submit a new rent payment proof
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
  const { property_tenant_id, billing_period, amount_due, amount_paid, payment_method, reference_number, screenshot_url, payment_date } = req.body;
  
  if (!property_tenant_id || !billing_period || !amount_paid || !payment_method || !reference_number || !screenshot_url || !payment_date) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // 1. Verify tenant owns this tenancy and it is currently 'due'
    const { data: tenancy, error: fetchError } = await supabase
      .from('property_tenants')
      .select('id, property_id, tenant_id, properties!inner(owner_id), rent_status')
      .eq('id', property_tenant_id)
      .eq('tenant_id', req.user.id)
      .single();

    if (fetchError || !tenancy) {
      return res.status(404).json({ message: 'Tenancy not found or unauthorized' });
    }

    if (tenancy.rent_status !== 'due') {
      return res.status(400).json({ message: `Cannot submit payment proof. Current status is ${tenancy.rent_status}.` });
    }

    // 2. Insert the proof
    const { data: proof, error: insertError } = await supabase
      .from('rent_payment_proofs')
      .insert({
        property_tenant_id,
        property_id: tenancy.property_id,
        owner_id: tenancy.properties.owner_id,
        tenant_id: req.user.id,
        billing_period,
        amount_due: amount_due || null,
        amount_paid,
        payment_method,
        reference_number,
        screenshot_url,
        payment_date,
        verification_status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') { // Unique violation
        return res.status(400).json({ message: 'A payment proof for this billing period already exists.' });
      }
      throw insertError;
    }

    // 3. Update tenancy status to pending
    const { error: updateError } = await supabase
      .from('property_tenants')
      .update({ rent_status: 'pending' })
      .eq('id', property_tenant_id);

    if (updateError) throw updateError;

    res.status(201).json({ message: 'Payment proof submitted successfully.', data: proof });
  } catch (err) {
    console.error('Error submitting payment proof:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/rent-payments/current/:propertyTenantId
// @desc    Get the payment proof for the current billing cycle
// @access  Private
router.get('/current/:propertyTenantId', authMiddleware, async (req, res) => {
  try {
    const { data: proof, error } = await supabase
      .from('rent_payment_proofs')
      .select('*')
      .eq('property_tenant_id', req.params.propertyTenantId)
      .order('billing_period', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    res.json({ data: proof });
  } catch (err) {
    console.error('Error fetching current payment proof:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/rent-payments/history
// @desc    Get historical payment proofs with filters and pagination
// @access  Private
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { 
      role = 'tenant', 
      property_id, 
      tenant_user_id, 
      date_from, 
      date_to, 
      page = 1, 
      limit = 10 
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Base query
    let query = supabase
      .from('rent_payment_proofs')
      .select('*, properties!inner(property_name), users!rent_payment_proofs_tenant_id_fkey(full_name)', { count: 'exact' })
      .eq('verification_status', 'approved');

    // Role-based security
    if (role === 'owner') {
      query = query.eq('owner_id', req.user.id);
      if (tenant_user_id) query = query.eq('tenant_id', tenant_user_id);
    } else {
      query = query.eq('tenant_id', req.user.id);
    }

    // Filters
    if (property_id) query = query.eq('property_id', property_id);
    if (date_from) query = query.gte('payment_date', date_from);
    if (date_to) query = query.lte('payment_date', date_to);

    // Sorting and Pagination
    query = query
      .order('payment_date', { ascending: false })
      .range(offset, offset + limitNum - 1);

    const { data: proofs, count, error } = await query;

    if (error) throw error;

    // Performance Optimization: Cache historical read-only data for 5 minutes
    res.set('Cache-Control', 'private, max-age=300');

    res.json({
      data: proofs,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil((count || 0) / limitNum)
      }
    });
  } catch (err) {
    console.error('Error fetching payment history:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/rent-payments/:id/approve
// @desc    Approve a rent payment proof
// @access  Private
router.put('/:id/approve', authMiddleware, async (req, res) => {
  try {
    // 1. Fetch the proof and associated tenant to verify ownership
    const { data: proof, error: fetchError } = await supabase
      .from('rent_payment_proofs')
      .select('*, property_tenants(*)')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !proof) {
      return res.status(404).json({ message: 'Payment proof not found' });
    }

    if (proof.owner_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (proof.verification_status === 'approved') {
      return res.status(400).json({ message: 'Payment proof is already approved' });
    }

    const tenant = proof.property_tenants;

    // We do atomic updates as much as possible by checking current states.
    // 2. Update the tenant record
    const { error: tenantError } = await supabase
      .from('property_tenants')
      .update({
        previous_last_paid_date: tenant.last_paid_date,
        previous_due_date: tenant.next_due_date,
        rent_status: 'paid',
        last_paid_date: proof.payment_date,
        next_due_date: calculateNextDueDate(tenant.billing_day, tenant.next_due_date)
      })
      .eq('id', proof.property_tenant_id)
      // Prevent skipped billing cycles / duplicate approvals
      .eq('rent_status', 'pending'); 

    if (tenantError) throw tenantError;

    // 3. Update the proof record
    const { error: proofError } = await supabase
      .from('rent_payment_proofs')
      .update({
        verification_status: 'approved',
        verified_at: new Date().toISOString(),
        verified_by: req.user.id
      })
      .eq('id', req.params.id);

    if (proofError) {
      // Manual rollback compensation since we lack true REST transactions
      await supabase.from('property_tenants').update({
        previous_last_paid_date: tenant.previous_last_paid_date,
        previous_due_date: tenant.previous_due_date,
        rent_status: 'pending',
        last_paid_date: tenant.last_paid_date,
        next_due_date: tenant.next_due_date
      }).eq('id', proof.property_tenant_id);
      throw proofError;
    }

    res.json({ message: 'Payment approved successfully' });
  } catch (err) {
    console.error('Error approving payment:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/rent-payments/tenants/:propertyTenantId/mark-due
// @desc    Revert tenant status to due, deleting the current proof
// @access  Private
router.put('/tenants/:propertyTenantId/mark-due', authMiddleware, async (req, res) => {
  try {
    const propertyTenantId = req.params.propertyTenantId;

    // 1. Fetch the tenant
    const { data: tenant, error: fetchError } = await supabase
      .from('property_tenants')
      .select('*, properties!inner(owner_id)')
      .eq('id', propertyTenantId)
      .single();

    if (fetchError || !tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    if (tenant.properties.owner_id !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (tenant.rent_status === 'due') {
      return res.status(400).json({ message: 'Tenant is already marked as due' });
    }

    // 2. Fetch and delete the current billing cycle proof (whether pending or approved)
    // We match by billing_period = current next_due_date, or previous_due_date if already advanced.
    // However, if the status is "pending", the current cycle proof is billing_period = next_due_date.
    // If the status is "paid", the current cycle proof is billing_period = previous_due_date.
    const targetBillingPeriod = tenant.rent_status === 'paid' ? tenant.previous_due_date : tenant.next_due_date;

    if (targetBillingPeriod) {
      await supabase
        .from('rent_payment_proofs')
        .delete()
        .eq('property_tenant_id', propertyTenantId)
        .eq('billing_period', targetBillingPeriod);
    }

    // 3. Restore tenant rollback fields
    const { error: tenantError } = await supabase
      .from('property_tenants')
      .update({
        last_paid_date: tenant.previous_last_paid_date,
        next_due_date: tenant.previous_due_date || tenant.next_due_date,
        rent_status: 'due',
        previous_last_paid_date: null,
        previous_due_date: null
      })
      .eq('id', propertyTenantId);

    if (tenantError) throw tenantError;

    res.json({ message: 'Tenant marked as due successfully' });
  } catch (err) {
    console.error('Error marking tenant as due:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
