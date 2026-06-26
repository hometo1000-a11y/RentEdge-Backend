const { supabase } = require('../config/supabase');
const imagekit = require('../config/imagekit');

/**
 * Cleanup temp uploads that are older than 24 hours.
 * Also deletes their associated files in ImageKit.
 */
async function tempUploadCleanup() {
  console.log(`[DataIntegrityWorker] 🧹 Running tempUploadCleanup...`);
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // Fetch old temp uploads
    const { data: oldUploads, error: fetchError } = await supabase
      .from('temp_uploads')
      .select('id, imagekit_file_id')
      .lt('created_at', twentyFourHoursAgo);
      
    if (fetchError) throw fetchError;
    
    if (!oldUploads || oldUploads.length === 0) {
      console.log(`[DataIntegrityWorker] No old temp uploads to clean up.`);
      return;
    }

    let deletedCount = 0;
    
    // Process each upload
    for (const upload of oldUploads) {
      // 1. Delete from ImageKit
      if (imagekit && upload.imagekit_file_id) {
        try {
          await imagekit.files.delete(upload.imagekit_file_id);
        } catch (ikErr) {
          console.error(`[DataIntegrityWorker] ✘ Failed to delete ImageKit file ${upload.imagekit_file_id}:`, ikErr.message);
          // If ImageKit fails, do we still delete from DB? 
          // Yes, to avoid infinite retry loops if the file doesn't exist.
          // The weekly orphan ImageKit sync can catch ghosts if needed.
        }
      }
      
      // 2. Delete from database
      const { error: delError } = await supabase
        .from('temp_uploads')
        .delete()
        .eq('id', upload.id);
        
      if (delError) {
        console.error(`[DataIntegrityWorker] ✘ Failed to delete DB row ${upload.id}:`, delError.message);
      } else {
        deletedCount++;
      }
    }
    
    console.log(`[DataIntegrityWorker] ✓ Deleted ${deletedCount} temp uploads.`);
  } catch (err) {
    console.error(`[DataIntegrityWorker] ✘ tempUploadCleanup failed:`, err);
  }
}

/**
 * Cleanup old join requests.
 * Approved requests: Deleted after 24 hours.
 * Rejected requests: Deleted after 7 days.
 * Pending requests: Kept indefinitely.
 */
async function joinRequestCleanup() {
  console.log(`[DataIntegrityWorker] 🧹 Running joinRequestCleanup...`);
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    // Delete approved (older than 24h)
    const { error: delApprovedError, count: approvedCount } = await supabase
      .from('property_join_requests')
      .delete({ count: 'exact' })
      .eq('status', 'approved')
      .lt('created_at', twentyFourHoursAgo);
      
    if (delApprovedError) {
      console.error(`[DataIntegrityWorker] ✘ Failed to delete approved join requests:`, delApprovedError.message);
    } else {
      console.log(`[DataIntegrityWorker] ✓ Deleted ${approvedCount || 0} approved join requests.`);
    }

    // Delete rejected (older than 7 days)
    const { error: delRejectedError, count: rejectedCount } = await supabase
      .from('property_join_requests')
      .delete({ count: 'exact' })
      .eq('status', 'rejected')
      .lt('created_at', sevenDaysAgo);
      
    if (delRejectedError) {
      console.error(`[DataIntegrityWorker] ✘ Failed to delete rejected join requests:`, delRejectedError.message);
    } else {
      console.log(`[DataIntegrityWorker] ✓ Deleted ${rejectedCount || 0} rejected join requests.`);
    }
  } catch (err) {
    console.error(`[DataIntegrityWorker] ✘ joinRequestCleanup failed:`, err);
  }
}

/**
 * Weekly Job: Find and delete orphan ImageKit files.
 * Deletes any ImageKit files that don't exist in property_images or temp_uploads.
 */
async function orphanImagekitSync() {
  console.log(`[DataIntegrityWorker] 🧹 Running orphanImagekitSync...`);
  if (!imagekit) {
    console.error(`[DataIntegrityWorker] ✘ ImageKit not configured.`);
    return;
  }
  
  try {
    // 1. Fetch ALL file IDs from ImageKit
    let imageKitFiles = [];
    let skip = 0;
    const limit = 100;
    
    while (true) {
      const files = await imagekit.files.listFiles({ skip, limit, fileType: 'image' });
      if (!files || files.length === 0) break;
      
      imageKitFiles.push(...files.map(f => f.fileId));
      skip += limit;
    }
    
    if (imageKitFiles.length === 0) {
      console.log(`[DataIntegrityWorker] No files found in ImageKit.`);
      return;
    }
    
    // 2. Fetch active file IDs from Database
    const { data: propImages, error: propErr } = await supabase.from('property_images').select('imagekit_file_id');
    if (propErr) throw propErr;
    
    const { data: tempImages, error: tempErr } = await supabase.from('temp_uploads').select('imagekit_file_id');
    if (tempErr) throw tempErr;
    
    const dbFileIds = new Set([
      ...propImages.map(img => img.imagekit_file_id),
      ...tempImages.map(img => img.imagekit_file_id)
    ]);
    
    // 3. Find orphans
    const orphans = imageKitFiles.filter(id => !dbFileIds.has(id));
    
    if (orphans.length === 0) {
      console.log(`[DataIntegrityWorker] ✓ No orphan ImageKit files found.`);
      return;
    }
    
    console.log(`[DataIntegrityWorker] Found ${orphans.length} orphan ImageKit files. Deleting...`);
    
    let deletedCount = 0;
    for (const orphanId of orphans) {
      try {
        await imagekit.files.delete(orphanId);
        deletedCount++;
      } catch (ikErr) {
        console.error(`[DataIntegrityWorker] ✘ Failed to delete orphan ${orphanId}:`, ikErr.message);
      }
    }
    
    console.log(`[DataIntegrityWorker] ✓ Deleted ${deletedCount} orphan ImageKit files.`);
    
  } catch (err) {
    console.error(`[DataIntegrityWorker] ✘ ImageKit cleanup failed:`, err);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────

function startDataIntegrityWorker() {
  console.log('[DataIntegrityWorker] 🚀 Worker initialized.');
  
  // Schedules:
  // tempUploadCleanup: Every 6 hours
  setInterval(tempUploadCleanup, 6 * 60 * 60 * 1000);
  
  // joinRequestCleanup: Daily at 03:00
  // Instead of complex cron logic, check every hour if it's 3 AM
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 3) {
      joinRequestCleanup();
    }
  }, 60 * 60 * 1000);
  
  // orphanImagekitSync: Weekly (every 7 days)
  setInterval(orphanImagekitSync, 7 * 24 * 60 * 60 * 1000);
  
  // Also run a sweep 5 minutes after startup to catch anything missed during downtime
  setTimeout(() => {
    tempUploadCleanup();
    joinRequestCleanup();
    // Don't run orphanImagekitSync on every startup to avoid API limits
  }, 5 * 60 * 1000);
}

module.exports = {
  startDataIntegrityWorker,
  tempUploadCleanup,
  joinRequestCleanup,
  orphanImagekitSync
};
