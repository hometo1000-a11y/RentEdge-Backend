const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

// @route   GET /api/public/properties
// @desc    Get paginated, filtered properties for public discovery
// @access  Public
router.get('/properties', async (req, res) => {
  try {
    let { 
      q, 
      state,
      city, 
      property_type, 
      bhk, 
      min_rent, 
      max_rent, 
      occupancy_type,
      sharing_type,
      furnishing,
      commercial_types,
      min_area,
      max_area,
      parking_required,
      tags,
      limit = 20, 
      offset = 0 
    } = req.query;

    limit = parseInt(limit);
    offset = parseInt(offset);

    const requiresDetailsJoin = bhk || sharing_type || furnishing || commercial_types || min_area || max_area || parking_required;
    const requiresTagsJoin = tags;

    // Start query
    let query = supabase
      .from('properties')
      .select(`
        *,
        users!properties_owner_id_fkey (full_name, phone),
        property_images (*),
        ${requiresTagsJoin ? 'property_tags!inner (*)' : 'property_tags (*)'},
        property_amenities (*),
        ${requiresDetailsJoin ? 'property_details!inner (details)' : 'property_details (details)'}
      `, { count: 'exact' })
      .eq('status', 'active');

    // Basic text search
    if (q) {
      query = query.or(`property_name.ilike.%${q}%,city.ilike.%${q}%,locality.ilike.%${q}%,short_description.ilike.%${q}%`);
    }

    // Location
    if (state && state !== 'All') query = query.ilike('state', `%${state}%`);
    if (city && city !== 'All') query = query.ilike('city', `%${city}%`);

    // Property Type Filter
    if (property_type && property_type !== 'All') {
      const types = property_type.split(',').map(t => t.trim());
      query = query.in('property_type', types);
    }

    // Tags Filtering
    if (requiresTagsJoin) {
      const tagList = tags.split(',').map(t => t.trim());
      query = query.in('property_tags.tag_name', tagList);
    }

    // Apply Sorting: newest first
    query = query.order('created_at', { ascending: false });

    // We do NOT paginate at DB level if we have complex JSON/OR filters 
    // that PostgREST cannot handle correctly (like casting JSON to numeric for budget OR filtering across tables).
    // Instead we fetch all matching the basic indexed constraints and paginate in memory.
    const { data: allData, error } = await query;

    if (error) {
      console.error('Error fetching public properties:', error);
      return res.status(500).json({ message: 'Error fetching properties', error: error.message });
    }

    let filteredData = allData || [];

    // Apply in-memory filters for complex JSON fields and mixed OR conditions (e.g., Rent)
    filteredData = filteredData.filter(prop => {
      const detailsArray = Array.isArray(prop.property_details) ? prop.property_details : [prop.property_details];
      const details = detailsArray.length > 0 && detailsArray[0] ? detailsArray[0].details || {} : {};

      // Occupancy Type
      if (occupancy_type && occupancy_type !== 'Any') {
        if (prop.occupancy_type !== occupancy_type) return false;
      }

      // Rent Filtering
      let effectiveRent = prop.rent_amount;
      if (prop.property_type === 'PG') {
        const withFood = Number(details.rent_with_food) || 0;
        const withoutFood = Number(details.rent_without_food) || 0;
        let foodOptFilter = req.query.food_option || 'BOTH';

        if (foodOptFilter === 'WITH_FOOD') effectiveRent = withFood;
        else if (foodOptFilter === 'WITHOUT_FOOD') effectiveRent = withoutFood;
        else {
           // BOTH: Use lower valid price for budget filtering
           if (withFood && withoutFood) effectiveRent = Math.min(withFood, withoutFood);
           else effectiveRent = withFood || withoutFood || 0;
        }
      }

      if (min_rent && effectiveRent < parseInt(min_rent)) return false;
      if (max_rent && effectiveRent > parseInt(max_rent)) return false;

      // BHK
      if (bhk && bhk !== 'Any') {
        const propBhk = parseInt(details.bhk) || 0;
        if (bhk === '3+') {
          if (propBhk < 3) return false;
        } else {
          if (propBhk !== parseInt(bhk)) return false;
        }
      }

      // Sharing Type
      if (sharing_type && sharing_type !== 'Any') {
        if (!details.sharing_types || !details.sharing_types.includes(sharing_type)) return false;
      }

      // PG Food Option
      if (req.query.food_option && req.query.food_option !== 'BOTH') {
        if (prop.property_type === 'PG' && details.food_option && details.food_option !== 'BOTH' && details.food_option !== req.query.food_option) {
          return false;
        }
      }

      // PG Attached Washroom
      if (req.query.attached_washroom === 'true') {
        if (prop.property_type === 'PG' && !details.attached_washroom) return false;
      }

      // Furnishing
      if (furnishing && furnishing !== 'Any') {
        if (details.classificationAnswers?.furnishing !== furnishing) return false;
      }

      // Parking
      if (parking_required === 'true') {
        if ((parseInt(details.parking_spaces) || 0) < 1) return false;
      }

      // Area
      if (min_area || max_area) {
        const area = Number(details.built_up_area) || Number(details.commercial_area) || Number(details.plot_area) || 0;
        if (min_area && area < parseInt(min_area)) return false;
        if (max_area && area > parseInt(max_area)) return false;
      }

      // Commercial Types
      if (commercial_types) {
        if (prop.property_type !== 'Commercial') return false;
        const cTypes = commercial_types.split(',');
        let match = false;
        if (cTypes.includes('office') && details.office) match = true;
        if (cTypes.includes('shop') && details.shop) match = true;
        if (cTypes.includes('warehouse') && details.warehouse) match = true;
        if (!match) return false;
      }

      return true;
    });

    const totalCount = filteredData.length;
    const paginatedData = filteredData.slice(offset, offset + limit);

    // Map data to expected format for frontend
    const mappedProperties = paginatedData.map(prop => {
      const detailsArray = Array.isArray(prop.property_details) ? prop.property_details : [prop.property_details];
      const details = detailsArray.length > 0 && detailsArray[0] ? detailsArray[0].details || {} : {};
      
      const tagsArray = Array.isArray(prop.property_tags) ? prop.property_tags : (prop.property_tags ? [prop.property_tags] : []);
      const tags = tagsArray.map(t => t.tag_name);

      const amenitiesArray = Array.isArray(prop.property_amenities) ? prop.property_amenities : (prop.property_amenities ? [prop.property_amenities] : []);
      const amenities = amenitiesArray.map(a => a.amenity_name);

      // Order images: cover image first, then by display_order
      const rawImages = Array.isArray(prop.property_images) ? prop.property_images : (prop.property_images ? [prop.property_images] : []);
      const images = rawImages.sort((a, b) => {
        if (a.is_cover && !b.is_cover) return -1;
        if (!a.is_cover && b.is_cover) return 1;
        return (a.display_order || 0) - (b.display_order || 0);
      });

      return {
        id: prop.id,
        title: prop.property_name,
        type: prop.property_type,
        city: prop.city,
        state: prop.state,
        area: prop.locality || prop.city,
        price: prop.rent_amount,
        rent: prop.rent_amount,
        deposit: prop.deposit_amount || 0,
        depositMonths: (prop.rent_amount && prop.deposit_amount) ? Math.round(prop.deposit_amount / prop.rent_amount) : 0,
        rentScoreRequired: 0,
        beds: details.bhk ? parseInt(details.bhk) : 1,
        bhk: details.bhk ? parseInt(details.bhk) : 1,
        baths: details.bathrooms ? parseInt(details.bathrooms) : 1,
        sqft: details.built_up_area || details.carpet_area || details.commercial_area || 0,
        images: images.length > 0 ? images.map(img => img.image_url) : ['https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-4.0.3&auto=format&fit=crop&w=1073&q=80'],
        image: images.length > 0 ? images[0].image_url : 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-4.0.3&auto=format&fit=crop&w=1073&q=80',
        availableFrom: prop.available_from || new Date().toISOString(),
        gender: prop.occupancy_type || 'Any',
        occupancy: prop.occupancy_type || 'Any',
        ownerName: prop.users ? prop.users.full_name : '',
        ownerPhoneFull: prop.users && prop.users.phone ? prop.users.phone : '',
        ownerPhoneMasked: prop.users && prop.users.phone ? `XXXXXX${prop.users.phone.slice(-4)}` : '',
        short_description: prop.short_description,
        tags: tags,
        amenities: amenities,
        details: details
      };
    });

    res.json({
      properties: mappedProperties,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: (offset + limit) < totalCount
      }
    });

  } catch (err) {
    console.error('Server error in public properties:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
