const express = require('express');
const router = express.Router();
const { db, supabase } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

// @route   GET /api/tenants/me
// @desc    Get current tenant profile
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
  try {
    let tenant = await db.selectFirst('tenants', { userId: req.user.id });
    
    // Auto-create tenant profile if it doesn't exist
    if (!tenant) {
      tenant = await db.insert('tenants', {
        userId: req.user.id,
        fullName: req.user.fullName,
        email: req.user.email,
        phone: req.user.phone || '',
        rentScore: 710, // default good starting credit rent score
        lifecycleState: 'BROWSING',
        selectedPropertyId: null,
        createdAt: new Date().toISOString()
      });
    }
    
    res.json(tenant);
  } catch (err) {
    console.error('Error fetching tenant profile:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/tenants/profile
// @desc    Update tenant profile details (rent score, selected property, etc.)
// @access  Private
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    let tenant = await db.selectFirst('tenants', { userId: req.user.id });
    if (!tenant) {
      tenant = await db.insert('tenants', {
        userId: req.user.id,
        fullName: req.user.fullName,
        email: req.user.email,
        phone: req.user.phone || '',
        rentScore: 710,
        lifecycleState: 'BROWSING',
        selectedPropertyId: null,
        createdAt: new Date().toISOString()
      });
    }

    const updated = await db.update('tenants', tenant.id, req.body);
    res.json(updated);
  } catch (err) {
    console.error('Error updating tenant profile:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/tenants
// @desc    Get all tenants (for dashboard / admin / landlords)
// @access  Private
router.get('/', authMiddleware, async (req, res) => {
  try {
    const tenants = await db.select('tenants');
    res.json(tenants);
  } catch (err) {
    console.error('Error fetching tenants list:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/tenants/join-property
// @desc    Tenant requests to join a property via code
// @access  Private
router.post('/join-property', authMiddleware, async (req, res) => {
  const { propertyCode } = req.body;
  if (!propertyCode) {
    return res.status(400).json({ message: 'Property code is required.' });
  }

  try {
    // 1. Find the property by code
    const { data: property, error: propError } = await supabase
      .from('properties')
      .select('id, owner_id')
      .eq('property_code', propertyCode.trim())
      .maybeSingle();

    if (propError || !property) {
      return res.status(404).json({ message: 'Invalid property code. Property not found.' });
    }

    // 2. Check if already a tenant
    const { data: activeTenancy } = await supabase
      .from('property_tenants')
      .select('id, status')
      .eq('tenant_id', req.user.id)
      .eq('property_id', property.id)
      .eq('status', 'active')
      .maybeSingle();

    if (activeTenancy) {
      return res.status(400).json({ message: 'You are already an active tenant of this property.' });
    }

    // 3. Check if request already exists
    const { data: existingReq, error: existingError } = await supabase
      .from('property_join_requests')
      .select('id, status')
      .eq('tenant_id', req.user.id)
      .eq('property_id', property.id)
      .maybeSingle();

    if (existingReq) {
      if (existingReq.status === 'rejected') {
        // Re-open the rejected request
        const { data: updatedReq, error: updateError } = await supabase
          .from('property_join_requests')
          .update({ status: 'pending', created_at: new Date().toISOString() })
          .eq('id', existingReq.id)
          .select()
          .single();

        if (updateError) {
          console.error('Error re-submitting join request:', updateError);
          return res.status(500).json({ message: 'Failed to re-submit join request.' });
        }
        return res.status(201).json({ message: 'Join request re-submitted successfully.', data: updatedReq });
      }
      return res.status(400).json({ message: `You have already requested to join this property. Status: ${existingReq.status}` });
    }

    // 3. Create request
    const { data: joinReq, error: joinError } = await supabase
      .from('property_join_requests')
      .insert({
        tenant_id: req.user.id,
        property_id: property.id,
        owner_id: property.owner_id,
        status: 'pending'
      })
      .select()
      .single();

    if (joinError) {
      console.error('Error creating join request:', joinError);
      return res.status(500).json({ message: 'Failed to submit join request.' });
    }

    res.status(201).json({ message: 'Join request submitted successfully.', data: joinReq });
  } catch (err) {
    console.error('Server error during join-property:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/tenants/my-properties
// @desc    Get properties the tenant is linked to (includes rent cycle data)
// @access  Private
router.get('/my-properties', authMiddleware, async (req, res) => {
  try {
    const { data: tenancies, error } = await supabase
      .from('property_tenants')
      .select(`
        id,
        status,
        rent_status,
        joined_at,
        lease_start_date,
        billing_day,
        next_due_date,
        last_paid_date,
        agreed_rent_amount,
        properties (
          *,
          users!properties_owner_id_fkey (full_name, phone, email)
        )
      `)
      .eq('tenant_id', req.user.id)
      .eq('status', 'active')
      .is('left_at', null);

    if (error) throw error;
    
    // Map it to return a clean list of properties, possibly including tenancy info
    // Similar to the /api/properties structure
    const properties = tenancies.map(t => {
      let p = t.properties;
      p.tenancy_id = t.id;
      p.joined_at = t.joined_at;
      // Rent cycle data
      p.rent_status = t.rent_status;
      p.lease_start_date = t.lease_start_date;
      p.billing_day = t.billing_day;
      p.next_due_date = t.next_due_date;
      p.last_paid_date = t.last_paid_date;
      p.agreed_rent_amount = t.agreed_rent_amount;
      if (p.users) {
        p.owner_name = p.users.full_name;
        p.owner_phone = p.users.phone;
        p.owner_email = p.users.email;
        delete p.users;
      }
      return p;
    });

    // We also need to fetch images, contacts, and payment info for these properties
    for (let prop of properties) {
      const rawImages = await db.select('property_images', { property_id: prop.id }, { column: 'display_order', ascending: true });
      prop.images = rawImages.sort((a, b) => {
        if (a.is_cover && !b.is_cover) return -1;
        if (!a.is_cover && b.is_cover) return 1;
        return (a.display_order ?? 0) - (b.display_order ?? 0);
      });
      prop.contacts = await db.select('property_contacts', { property_id: prop.id });
      prop.payment_info = await db.selectFirst('owner_payment_info', { user_id: prop.owner_id });
      
      const am = await db.select('property_amenities', { property_id: prop.id });
      prop.amenities = am.map(a => a.amenity_name);
      
      const pd = await db.selectFirst('property_details', { property_id: prop.id });
      prop.details = pd ? pd.details : {};
      
      prop.description = prop.full_description || prop.short_description || '';
    }

    res.json(properties);
  } catch (err) {
    console.error('Error fetching my-properties:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
