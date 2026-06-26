require('dotenv').config();
const admin = require('../config/firebase');
const { supabase } = require('../config/supabase');

async function cleanupGhostUsers() {
  console.log('Starting Firebase ghost user cleanup...');

  try {
    let nextPageToken;
    let deletedCount = 0;

    // 24 hours ago
    const thresholdTime = Date.now() - 24 * 60 * 60 * 1000;

    do {
      const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
      
      for (const userRecord of listUsersResult.users) {
        const creationTime = new Date(userRecord.metadata.creationTime).getTime();

        // If user is older than 24 hours
        if (creationTime < thresholdTime) {
          // Check if they exist in Supabase
          const { data: supabaseUser } = await supabase
            .from('users')
            .select('id')
            .eq('firebase_uid', userRecord.uid)
            .maybeSingle();

          if (!supabaseUser) {
            // Found a ghost user! Check if they are verified.
            // As per requirements: only remove UNVERIFIED orphaned accounts.
            if (!userRecord.emailVerified) {
              console.log(`Deleting unverified ghost user: ${userRecord.uid} (${userRecord.email || userRecord.phoneNumber})`);
              await admin.auth().deleteUser(userRecord.uid);
              deletedCount++;
            } else {
              console.log(`Keeping verified ghost user (recoverable): ${userRecord.uid} (${userRecord.email})`);
            }
          }
        }
      }

      nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);

    console.log(`Cleanup complete. Deleted ${deletedCount} unverified ghost accounts.`);
    process.exit(0);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupGhostUsers();
