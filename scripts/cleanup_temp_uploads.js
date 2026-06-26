/**
 * RentEdge - Cleanup Temporary Uploads
 * 
 * Script to delete orphaned images from ImageKit and DB
 * 
 * Usage: node cleanup_temp_uploads.js
 */

const { supabase } = require('../config/supabase');
const imagekit = require('../config/imagekit');

async function cleanup() {
  console.log('🧹 Starting cleanup of orphaned temporary uploads...');
  const startTime = Date.now();
  let deletedCount = 0;
  let failedCount = 0;

  try {
    // 1. Find temp_uploads older than 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: orphans, error } = await supabase
      .from('temp_uploads')
      .select('*')
      .lt('created_at', twentyFourHoursAgo);

    if (error) {
      throw error;
    }

    console.log(`Found ${orphans.length} orphaned uploads.`);

    // 2. For each record, delete from IK and then DB
    for (const record of orphans) {
      try {
        if (imagekit) {
          await imagekit.files.delete(record.imagekit_file_id);
          console.log(`✅ Deleted from ImageKit: ${record.imagekit_file_id}`);
        }
        
        await supabase.from('temp_uploads').delete().eq('id', record.id);
        console.log(`✅ Deleted from database: ${record.id}`);
        
        deletedCount++;
      } catch (err) {
        console.error(`❌ Failed to cleanup record ${record.id}:`, err.message);
        failedCount++;
      }
    }

    const duration = Date.now() - startTime;
    console.log('\n--- Cleanup Summary ---');
    console.log(`Files deleted: ${deletedCount}`);
    console.log(`Failures:      ${failedCount}`);
    console.log(`Execution time: ${duration}ms`);
    console.log('-----------------------');

  } catch (err) {
    console.error('❌ Cleanup script failed:', err);
  }
}

cleanup();
