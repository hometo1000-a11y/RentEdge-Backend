const express = require('express');
const router = express.Router();
const { db, supabase } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');
const { calculateNextDueDate, calculatePreviousDueDate } = require('../services/rentDueWorker');

function generateSmartTags(tags, details) {
  let computedTags = [...(tags || [])];
  if (details && details.classificationAnswers) {
    const ca = details.classificationAnswers;
    // Smart Location Tags (High-value discovery signals)
    if (ca.nearMetro) computedTags.push('Near Metro');
    if (ca.nearITPark) computedTags.push('Tech Hub');
    if (ca.nearCollege) computedTags.push('Student Friendly');
    // Property Quality Tags
    if (ca.furnishing && ca.furnishing !== 'Unfurnished') {
      computedTags.push(ca.furnishing);
    }
    if (ca.positioning) {
      computedTags.push(ca.positioning);
    }
    // NOTE: suitableFor removed — occupancy_type is the source of truth.
    // NOTE: nearBusStop, nearRailwayStation, nearAirport, nearSchool, nearHospital removed — dead fields.
    // NOTE: gatedCommunity, fireSafety moved to Amenities.
  }
  return [...new Set(computedTags)];
}

// @route   GET /api/properties
// @desc    Get all properties for the authenticated owner
// @access  Private
router.get('/', authMiddleware, async (req, res) => {
  try {
    const properties = await db.select('properties', { owner_id: req.user.id, status: 'active' });
    const user = await db.selectFirst('users', { id: req.user.id });
    
    // Fetch related images and tags to populate the card view
    for (let prop of properties) {
      const rawImages1 = await db.select('property_images', { property_id: prop.id }, { column: 'display_order', ascending: true });
      prop.images = rawImages1.sort((a, b) => {
        if (a.is_cover && !b.is_cover) return -1;
        if (!a.is_cover && b.is_cover) return 1;
        return (a.display_order ?? 0) - (b.display_order ?? 0);
      });
      prop.tags = await db.select('property_tags', { property_id: prop.id });
      prop.amenities = await db.select('property_amenities', { property_id: prop.id });
      prop.highlights = await db.select('property_highlights', { property_id: prop.id });
      const pd = await db.selectFirst('property_details', { property_id: prop.id });
      prop.details = pd ? pd.details : {};
      prop.users = user ? { full_name: user.full_name, phone: user.phone } : null;
    }

    res.json(properties);
  } catch (err) {
    console.error('Error fetching properties:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// @route   GET /api/properties/join-requests
// @desc    Get all join requests for properties owned by the authenticated owner
// @access  Private
router.get('/join-requests', authMiddleware, async (req, res) => {
  try {
    const { data: requests, error } = await supabase
      .from('property_join_requests')
      .select(`
        id,
        status,
        created_at,
        users!property_join_requests_tenant_id_fkey (
          id,
          full_name,
          email,
          phone
        ),
        properties (
          id,
          property_name,
          property_code
        )
      `)
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(requests);
  } catch (err) {
    console.error('Error fetching join requests:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/properties/join-requests/:requestId
// @desc    Update status of a join request (with rent cycle setup on approval)
// @access  Private
router.put('/join-requests/:requestId', authMiddleware, async (req, res) => {
  const { status, lease_start_date } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  try {
    const { data: updated, error } = await supabase
      .from('property_join_requests')
      .update({ status })
      .eq('id', req.params.requestId)
      .eq('owner_id', req.user.id)
      .select()
      .single();

    if (error || !updated) {
      return res.status(404).json({ message: 'Request not found or unauthorized' });
    }

    // If approved, create property_tenants relationship with rent cycle data
    if (status === 'approved') {
      // Determine the lease start date (default: today)
      // Parse as string to avoid timezone issues (IST offset causes day drift)
      let startDateISO;
      let billingDay;
      if (lease_start_date) {
        startDateISO = String(lease_start_date).split('T')[0]; // YYYY-MM-DD
        billingDay = parseInt(startDateISO.split('-')[2], 10); // Day part
      } else {
        const now = new Date();
        startDateISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        billingDay = now.getDate();
      }

      // Fetch the current property rent to lock as agreed_rent_amount
      const { data: property } = await supabase
        .from('properties')
        .select('rent_amount')
        .eq('id', updated.property_id)
        .single();

      const agreedRent = property ? (property.rent_amount || 0) : 0;

      // The first rent is immediately due on the start date
      const nextDueDate = startDateISO;

      const { error: relError } = await supabase
        .from('property_tenants')
        .insert({
          property_id: updated.property_id,
          tenant_id: updated.tenant_id,
          status: 'active',
          rent_status: 'due',
          lease_start_date: startDateISO,
          billing_day: billingDay,
          next_due_date: nextDueDate,
          last_paid_date: null,
          agreed_rent_amount: agreedRent
        });
      
      // Ignore duplicate key errors if relationship already exists
      if (relError && relError.code !== '23505') {
        console.error('Error creating property_tenant relationship:', relError);
        // Continue anyway since request was approved
      }
    }

    res.json({ message: `Request ${status} successfully`, data: updated });
  } catch (err) {
    console.error('Error updating join request:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// @route   GET /api/properties/tenants
// @desc    Get all active tenants for the owner's properties (includes rent cycle data)
// @access  Private
router.get('/tenants', authMiddleware, async (req, res) => {
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
        left_at,
        users!property_tenants_tenant_id_fkey (
          id,
          full_name,
          email,
          phone
        ),
        properties!inner (
          id,
          property_name,
          owner_id,
          rent_amount
        )
      `)
      .eq('properties.owner_id', req.user.id)
      .eq('status', 'active')
      .is('left_at', null);

    if (error) throw error;
    res.json(tenancies);
  } catch (err) {
    console.error('Error fetching properties tenants:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/properties/tenants/:id/rent-status
// @desc    Update rent status for a property tenant (with rent cycle advancement on 'paid')
// @access  Private
router.put('/tenants/:id/rent-status', authMiddleware, async (req, res) => {
  const { rent_status } = req.body;
  if (!['paid', 'due'].includes(rent_status)) {
    return res.status(400).json({ message: 'Invalid rent status' });
  }

  try {
    const { data: tenant, error: fetchError } = await supabase
      .from('property_tenants')
      .select('id, rent_status, billing_day, next_due_date, last_paid_date, previous_last_paid_date, previous_due_date, agreed_rent_amount, tenant_id, properties!inner(id, owner_id, rent_amount)')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !tenant || tenant.properties.owner_id !== req.user.id) {
      return res.status(404).json({ message: 'Tenant not found or unauthorized' });
    }

    // Build the update payload
    const updatePayload = { rent_status };

    // Idempotent operations: only change dates if status is actually transitioning
    if (rent_status !== tenant.rent_status && !tenant.next_due_date) {
      return res.status(400).json({ message: 'Cannot change status: rent cycle is not configured (missing next_due_date).' });
    }

    if (rent_status === 'paid' && tenant.rent_status !== 'paid') {
      const now = new Date();
      const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      updatePayload.previous_last_paid_date = tenant.last_paid_date;
      updatePayload.previous_due_date = tenant.next_due_date;
      
      updatePayload.last_paid_date = todayISO;
      updatePayload.next_due_date = calculateNextDueDate(
        tenant.billing_day,
        tenant.next_due_date
      );

      // Create owner override payment proof
      const amountPaid = tenant.agreed_rent_amount || tenant.properties.rent_amount || 0;
      const { error: insertError } = await supabase
        .from('rent_payment_proofs')
        .insert({
          property_tenant_id: tenant.id,
          property_id: tenant.properties.id,
          tenant_id: tenant.tenant_id,
          owner_id: tenant.properties.owner_id,
          billing_period: tenant.next_due_date,
          amount_paid: amountPaid,
          payment_method: 'Owner Override',
          reference_number: 'MANUAL',
          payment_date: todayISO,
          screenshot_url: '',
          verification_status: 'approved',
          verified_at: new Date().toISOString(),
          verified_by: req.user.id
        });

      if (insertError) {
        if (insertError.code === '23505') {
          return res.status(400).json({ message: 'Proof already exists for this billing cycle.' });
        }
        throw insertError;
      }
    } else if (rent_status === 'due' && tenant.rent_status !== 'due') {
      updatePayload.last_paid_date = tenant.previous_last_paid_date;
      updatePayload.next_due_date = tenant.previous_due_date || calculatePreviousDueDate(
        tenant.billing_day, 
        tenant.next_due_date
      );
      
      updatePayload.previous_last_paid_date = null;
      updatePayload.previous_due_date = null;

      // Delete the current billing cycle proof
      await supabase
        .from('rent_payment_proofs')
        .delete()
        .eq('property_tenant_id', tenant.id)
        .eq('billing_period', tenant.previous_due_date || tenant.next_due_date);
    }

    const { data: updated, error } = await supabase
      .from('property_tenants')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Rent status updated successfully', data: updated });
  } catch (err) {
    console.error('Error updating rent status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/properties/tenants/:id
// @desc    Remove a tenant from a property (soft-delete: sets left_at + status=past)
// @access  Private
router.delete('/tenants/:id', authMiddleware, async (req, res) => {
  try {
    const { data: tenant, error: fetchError } = await supabase
      .from('property_tenants')
      .select('id, properties!inner(owner_id)')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !tenant || tenant.properties.owner_id !== req.user.id) {
      return res.status(404).json({ message: 'Tenant not found or unauthorized' });
    }

    const { error: updateError } = await supabase
      .from('property_tenants')
      .update({
        status: 'past',
        left_at: new Date().toISOString()
      })
      .eq('id', req.params.id);

    if (updateError) throw updateError;
    res.json({ message: 'Tenant removed successfully' });
  } catch (err) {
    console.error('Error removing tenant:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/properties/:id
// @desc    Get a property by ID including images, tags, and contacts
// @access  Private
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) {
      return res.status(404).json({ message: 'Property not found or unauthorized' });
    }
    const user = await db.selectFirst('users', { id: req.user.id });
    property.users = user ? { full_name: user.full_name, phone: user.phone } : null;

    const rawImages2 = await db.select('property_images', { property_id: property.id }, { column: 'display_order', ascending: true });
    property.images = rawImages2.sort((a, b) => {
      if (a.is_cover && !b.is_cover) return -1;
      if (!a.is_cover && b.is_cover) return 1;
      return (a.display_order ?? 0) - (b.display_order ?? 0);
    });
    property.tags = await db.select('property_tags', { property_id: property.id });
    property.contacts = await db.select('property_contacts', { property_id: property.id });
    property.amenities = await db.select('property_amenities', { property_id: property.id });
    property.highlights = await db.select('property_highlights', { property_id: property.id });
    const pd = await db.selectFirst('property_details', { property_id: property.id });
    property.details = pd ? pd.details : {};

    // Fetch tenants
    const { data: tenancies } = await supabase
      .from('property_tenants')
      .select(`
        id, status, rent_status, joined_at,
        users!property_tenants_tenant_id_fkey (id, full_name, email, phone)
      `)
      .eq('property_id', property.id);
    
    property.tenants = tenancies || [];

    res.json(property);
  } catch (err) {
    console.error('Error fetching property:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/properties
// @desc    Create a new property
// @access  Private
router.post('/', authMiddleware, async (req, res) => {
  const {
    property_name, property_type, short_description, full_description, address, city, state, pincode,
    rent_amount, deposit_amount, maintenance_amount, occupancy_type,
    locality, landmark, tags, contacts, session_id, amenities, highlights, details
  } = req.body;

  if (!property_name || !property_type || !address || !city || !state || !pincode || !rent_amount || !deposit_amount || !session_id) {
    return res.status(400).json({ message: 'Missing required property fields or session_id' });
  }

  try {
    const newProperty = await db.insert('properties', {
      owner_id: req.user.id,
      property_name,
      property_type,
      short_description,
      full_description,
      address,
      city,
      state,
      pincode,
      locality,
      landmark,
      occupancy_type: occupancy_type || 'Any',
      rent_amount: Number(rent_amount),
      deposit_amount: Number(deposit_amount),
      maintenance_amount: Number(maintenance_amount || 0),
      status: 'active'
    });

    await db.insert('property_details', {
      property_id: newProperty.id,
      details: details || {}
    });

    // ═══════════════════════════════════════════════════════════════
    // IMAGE PIPELINE: Link temp_uploads → property_images
    // ═══════════════════════════════════════════════════════════════
    console.log(`[IMAGE PIPELINE] Property ${newProperty.id} — Querying temp_uploads for session_id=${session_id}, owner_id=${req.user.id}`);
    const tempUploads = await db.select('temp_uploads', { session_id, owner_id: req.user.id });
    console.log(`[IMAGE PIPELINE] Found ${tempUploads.length} temp_upload(s) for session ${session_id}`);

    if (tempUploads.length === 0) {
      console.warn(`[IMAGE PIPELINE] ⚠ ZERO temp_uploads found. Images will NOT be linked to property ${newProperty.id}.`);
      console.warn(`[IMAGE PIPELINE]   session_id sent: "${session_id}"`);
      console.warn(`[IMAGE PIPELINE]   owner_id: "${req.user.id}"`);
      console.warn(`[IMAGE PIPELINE]   frontend images array length: ${req.body.images ? req.body.images.length : 'undefined'}`);
    }

    let fallbackOrder = 0;
    let linkedCount = 0;
    for (const temp of tempUploads) {
      console.log(`[IMAGE PIPELINE] Processing file ${fallbackOrder + 1}/${tempUploads.length}: fileId=${temp.imagekit_file_id}`);
      console.log(`[IMAGE PIPELINE]   Original URL: ${temp.image_url}`);

      // Validate the image URL actually resolves before storing
      const imageUrl = temp.image_url;
      try {
        const headCheck = await fetch(imageUrl, { method: 'HEAD' });
        if (headCheck.status !== 200) {
          console.error(`[IMAGE PIPELINE] ✘ URL returns HTTP ${headCheck.status} — skipping file ${temp.imagekit_file_id}`);
          console.error(`[IMAGE PIPELINE]   Broken URL: ${imageUrl}`);
          fallbackOrder++;
          continue;
        }
        console.log(`[IMAGE PIPELINE]   ✓ URL verified (HTTP ${headCheck.status})`);
      } catch (headErr) {
        console.error(`[IMAGE PIPELINE] ✘ URL verification failed for ${temp.imagekit_file_id}:`, headErr.message);
        fallbackOrder++;
        continue;
      }

      const frontendImg = req.body.images ? req.body.images.find((img) => img.imagekit_file_id === temp.imagekit_file_id) : null;
      const isCover = frontendImg ? frontendImg.is_cover : (fallbackOrder === 0);
      const displayOrder = frontendImg && frontendImg.display_order !== undefined ? frontendImg.display_order : fallbackOrder;

      const insertedImage = await db.insert('property_images', {
        property_id: newProperty.id,
        imagekit_file_id: temp.imagekit_file_id,
        image_url: imageUrl,
        thumbnail_url: imageUrl + '?tr=w-200',
        display_order: displayOrder,
        is_cover: isCover
      });
      console.log(`[IMAGE PIPELINE]   ✓ Inserted property_images row: id=${insertedImage.id}, is_cover=${isCover}, order=${displayOrder}`);
      linkedCount++;
      
      if (isCover) {
        await db.update('properties', newProperty.id, { cover_image_url: imageUrl });
        newProperty.cover_image_url = imageUrl;
        console.log(`[IMAGE PIPELINE]   ✓ Set as cover image for property ${newProperty.id}`);
      }
      
      fallbackOrder++;
      await db.delete('temp_uploads', temp.id);
      console.log(`[IMAGE PIPELINE]   ✓ Deleted temp_upload record ${temp.id}`);
    }
    console.log(`[IMAGE PIPELINE] ✅ Complete: ${linkedCount}/${tempUploads.length} images linked to property ${newProperty.id}`);

    const finalTags = generateSmartTags(tags, details);
    if (finalTags.length > 0) {
      for (const tag of finalTags) {
        await db.insert('property_tags', { property_id: newProperty.id, tag_name: tag });
      }
    }

    if (contacts && contacts.length > 0) {
      for (const contact of contacts) {
        await db.insert('property_contacts', {
          property_id: newProperty.id,
          name: contact.name,
          role: contact.role,
          phone: contact.phone,
          whatsapp: contact.whatsapp,
          email: contact.email
        });
      }
    }

    if (amenities && amenities.length > 0) {
      for (const amenity of amenities) {
        await db.insert('property_amenities', { property_id: newProperty.id, amenity_name: amenity });
      }
    }

    if (highlights && highlights.length > 0) {
      for (const hl of highlights) {
        await db.insert('property_highlights', { property_id: newProperty.id, highlight_text: hl });
      }
    }

    res.status(201).json(newProperty);
  } catch (err) {
    console.error('Error creating property:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/properties/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) {
      return res.status(404).json({ message: 'Property not found or unauthorized' });
    }

    const {
      property_name, property_type, short_description, full_description, address, city, state, pincode,
      rent_amount, deposit_amount, maintenance_amount, occupancy_type,
      locality, landmark, session_id, tags, amenities, highlights, contacts, details
    } = req.body;

    const updatedProperty = await db.update('properties', req.params.id, {
      property_name,
      property_type,
      short_description,
      full_description,
      address,
      city,
      state,
      pincode,
      locality,
      landmark,
      occupancy_type: occupancy_type || 'Any',
      rent_amount: Number(rent_amount),
      deposit_amount: Number(deposit_amount),
      maintenance_amount: Number(maintenance_amount || 0)
    });

    const existingDetails = await db.selectFirst('property_details', { property_id: property.id });
    if (existingDetails) {
       await db.update('property_details', existingDetails.id, { details: details || {} });
    } else {
       await db.insert('property_details', { property_id: property.id, details: details || {} });
    }

    if (session_id) {
      // ═══════════════════════════════════════════════════════════════
      // IMAGE PIPELINE (UPDATE): Link new temp_uploads → property_images
      // ═══════════════════════════════════════════════════════════════
      console.log(`[IMAGE PIPELINE:UPDATE] Property ${property.id} — Querying temp_uploads for session_id=${session_id}, owner_id=${req.user.id}`);
      const tempUploads = await db.select('temp_uploads', { session_id, owner_id: req.user.id });
      console.log(`[IMAGE PIPELINE:UPDATE] Found ${tempUploads.length} temp_upload(s) for session ${session_id}`);

      if (tempUploads.length > 0) {
        const currentImages = await db.select('property_images', { property_id: property.id });
        let fallbackOrder = currentImages.length;
        let linkedCount = 0;
        
        for (const temp of tempUploads) {
          console.log(`[IMAGE PIPELINE:UPDATE] Processing file: fileId=${temp.imagekit_file_id}`);
          console.log(`[IMAGE PIPELINE:UPDATE]   Original URL: ${temp.image_url}`);

          // Validate the image URL actually resolves before storing
          const imageUrl = temp.image_url;
          try {
            const headCheck = await fetch(imageUrl, { method: 'HEAD' });
            if (headCheck.status !== 200) {
              console.error(`[IMAGE PIPELINE:UPDATE] ✘ URL returns HTTP ${headCheck.status} — skipping file ${temp.imagekit_file_id}`);
              fallbackOrder++;
              continue;
            }
            console.log(`[IMAGE PIPELINE:UPDATE]   ✓ URL verified (HTTP ${headCheck.status})`);
          } catch (headErr) {
            console.error(`[IMAGE PIPELINE:UPDATE] ✘ URL verification failed:`, headErr.message);
            fallbackOrder++;
            continue;
          }

          const frontendImg = req.body.images ? req.body.images.find((img) => img.imagekit_file_id === temp.imagekit_file_id) : null;
          const isCover = frontendImg ? frontendImg.is_cover : (currentImages.length === 0 && fallbackOrder === 0);
          const displayOrder = frontendImg && frontendImg.display_order !== undefined ? frontendImg.display_order : fallbackOrder;

          const insertedImage = await db.insert('property_images', {
            property_id: property.id,
            imagekit_file_id: temp.imagekit_file_id,
            image_url: imageUrl,
            thumbnail_url: imageUrl + '?tr=w-200',
            display_order: displayOrder,
            is_cover: isCover
          });
          console.log(`[IMAGE PIPELINE:UPDATE]   ✓ Inserted property_images row: id=${insertedImage.id}, is_cover=${isCover}, order=${displayOrder}`);
          linkedCount++;
          
          if (isCover) {
            const allCurrent = await db.select('property_images', { property_id: property.id });
            for (const ac of allCurrent) {
              if (ac.is_cover && ac.imagekit_file_id !== temp.imagekit_file_id) {
                await db.update('property_images', ac.id, { is_cover: false });
              }
            }
            await db.update('properties', property.id, { cover_image_url: imageUrl });
            updatedProperty.cover_image_url = imageUrl;
            console.log(`[IMAGE PIPELINE:UPDATE]   ✓ Set as cover image`);
          }
          fallbackOrder++;
          await db.delete('temp_uploads', temp.id);
          console.log(`[IMAGE PIPELINE:UPDATE]   ✓ Deleted temp_upload record ${temp.id}`);
        }
        console.log(`[IMAGE PIPELINE:UPDATE] ✅ Complete: ${linkedCount}/${tempUploads.length} images linked to property ${property.id}`);
      }
    }

    if (tags || details) {
      const finalTags = generateSmartTags(tags, details);
      const currentTags = await db.select('property_tags', { property_id: property.id });
      for (const t of currentTags) await db.delete('property_tags', t.id);
      for (const tag of finalTags) await db.insert('property_tags', { property_id: property.id, tag_name: tag });
    }
    
    if (amenities) {
      const currentAm = await db.select('property_amenities', { property_id: property.id });
      for (const a of currentAm) await db.delete('property_amenities', a.id);
      for (const amenity of amenities) await db.insert('property_amenities', { property_id: property.id, amenity_name: amenity });
    }

    if (highlights) {
      const currentHl = await db.select('property_highlights', { property_id: property.id });
      for (const h of currentHl) await db.delete('property_highlights', h.id);
      for (const hl of highlights) await db.insert('property_highlights', { property_id: property.id, highlight_text: hl });
    }

    if (contacts) {
      const currentContacts = await db.select('property_contacts', { property_id: property.id });
      for (const c of currentContacts) await db.delete('property_contacts', c.id);
      for (const contact of contacts) {
        await db.insert('property_contacts', {
          property_id: property.id,
          name: contact.name,
          role: contact.role,
          phone: contact.phone,
          whatsapp: contact.whatsapp,
          email: contact.email
        });
      }
    }

    res.json(updatedProperty);
  } catch (err) {
    console.error('Error updating property:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/properties/:id
// @desc    Archive a property (does not hard delete)
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) {
      return res.status(404).json({ message: 'Property not found or unauthorized' });
    }

    // UPDATE PROPERTY TO ARCHIVED
    await db.update('properties', property.id, { status: 'archived' });

    // TENANT REMOVAL RULE: Set active tenants to inactive to preserve history
    // and naturally decouple them from rentDueWorker.js
    const { error: updateError } = await supabase
      .from('property_tenants')
      .update({
        status: 'inactive',
        left_at: new Date().toISOString()
      })
      .eq('property_id', property.id)
      .eq('status', 'active');
      
    if (updateError) {
      console.error('Error deactivating tenants during archive:', updateError);
    }

    res.json({ message: 'Property archived successfully' });
  } catch (err) {
    console.error('Error archiving property:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// --- PROPERTY IMAGES ROUTES ---

// @route   POST /api/properties/:id/images
// @desc    Add an image to a property
// @access  Private
router.post('/:id/images', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) return res.status(404).json({ message: 'Unauthorized' });

    const { imagekit_file_id, image_url, thumbnail_url, display_order } = req.body;
    const newImage = await db.insert('property_images', {
      property_id: property.id,
      imagekit_file_id,
      image_url,
      thumbnail_url,
      display_order: display_order || 0,
      is_cover: false
    });
    res.status(201).json(newImage);
  } catch (err) {
    console.error('Error adding image:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/properties/:id/images/:imageId
// @desc    Delete an image from a property
// @access  Private
router.delete('/:id/images/:imageId', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) return res.status(404).json({ message: 'Unauthorized' });

    const image = await db.selectFirst('property_images', { id: req.params.imageId, property_id: property.id });
    if (!image) return res.status(404).json({ message: 'Image not found' });

    const imagekit = require('../config/imagekit');
    if (imagekit) {
      try {
        await imagekit.files.delete(image.imagekit_file_id);
      } catch (e) {
        console.error("Failed to delete from ImageKit:", e);
      }
    }

    await db.delete('property_images', req.params.imageId);

    if (image.is_cover) {
      const remainingImages = await db.select('property_images', { property_id: property.id }, { column: 'display_order', ascending: true });
      if (remainingImages.length > 0) {
        await db.update('property_images', remainingImages[0].id, { is_cover: true });
        // Update properties table for fallback compatibility
        await db.update('properties', property.id, { cover_image_url: remainingImages[0].image_url });
      } else {
        await db.update('properties', property.id, { cover_image_url: null });
      }
    }

    res.json({ message: 'Image deleted' });
  } catch (err) {
    console.error('Error deleting image:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PATCH /api/properties/:id/images/:imageId/cover
// @desc    Set an image as the cover image
// @access  Private
router.patch('/:id/images/:imageId/cover', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) return res.status(404).json({ message: 'Unauthorized' });

    const image = await db.selectFirst('property_images', { id: req.params.imageId, property_id: property.id });
    if (!image) return res.status(404).json({ message: 'Image not found' });

    // Reset all other images to is_cover = false
    const currentImages = await db.select('property_images', { property_id: property.id });
    for (const img of currentImages) {
      if (img.is_cover) {
        await db.update('property_images', img.id, { is_cover: false });
      }
    }

    // Set new cover
    await db.update('property_images', req.params.imageId, { is_cover: true });
    // Update property fallback
    await db.update('properties', property.id, { cover_image_url: image.image_url });

    res.json({ message: 'Cover image updated' });
  } catch (err) {
    console.error('Error setting cover image:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PATCH /api/properties/:id/images/reorder
// @desc    Reorder images
// @access  Private
router.patch('/:id/images/reorder', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) return res.status(404).json({ message: 'Unauthorized' });

    const orderData = req.body; // Array of { id, display_order }
    for (const item of orderData) {
      await db.update('property_images', item.id, { display_order: item.display_order });
    }
    
    res.json({ message: 'Images reordered' });
  } catch (err) {
    console.error('Error reordering images:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// --- PROPERTY CONTACTS ROUTES ---

// @route   POST /api/properties/:id/contacts
// @desc    Add a contact to a property
// @access  Private
router.post('/:id/contacts', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) return res.status(404).json({ message: 'Unauthorized' });

    const newContact = await db.insert('property_contacts', {
      property_id: property.id,
      ...req.body
    });
    res.status(201).json(newContact);
  } catch (err) {
    console.error('Error adding contact:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/properties/:id/contacts/:contactId
// @desc    Update a contact
// @access  Private
router.put('/:id/contacts/:contactId', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) return res.status(404).json({ message: 'Unauthorized' });

    const updatedContact = await db.update('property_contacts', req.params.contactId, req.body);
    res.json(updatedContact);
  } catch (err) {
    console.error('Error updating contact:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/properties/:id/contacts/:contactId
// @desc    Delete a contact
// @access  Private
router.delete('/:id/contacts/:contactId', authMiddleware, async (req, res) => {
  try {
    const property = await db.selectFirst('properties', { id: req.params.id, owner_id: req.user.id });
    if (!property) return res.status(404).json({ message: 'Unauthorized' });

    await db.delete('property_contacts', req.params.contactId);
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    console.error('Error deleting contact:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
