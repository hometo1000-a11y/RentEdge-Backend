const express = require('express');
const router = express.Router();
const imagekit = require('../config/imagekit');
const authMiddleware = require('../middleware/auth');
const { db } = require('../config/supabase');

// @route   GET /api/imagekit/auth
router.get('/auth', authMiddleware, (req, res) => {
  try {
    if (!imagekit) {
      throw new Error("ImageKit is not initialized. Check environment variables.");
    }
    const authenticationParameters = imagekit.helper.getAuthenticationParameters();
    res.json(authenticationParameters);
  } catch (err) {
    console.error('Error generating ImageKit auth parameters:', err);
    res.status(500).json({ 
      message: 'Failed to get authentication parameters', 
      error: err.message || err.toString() 
    });
  }
});

// @route   POST /api/imagekit/temp-upload
router.post('/temp-upload', authMiddleware, async (req, res) => {
  const { session_id, imagekit_file_id, image_url } = req.body;
  if (!session_id || !imagekit_file_id || !image_url) {
    return res.status(400).json({ message: 'Missing fields' });
  }
  try {
    const record = await db.insert('temp_uploads', {
      owner_id: req.user.id,
      session_id,
      imagekit_file_id,
      image_url
    });
    res.status(201).json(record);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// @route   GET /api/imagekit/temp/:sessionId
router.get('/temp/:sessionId', authMiddleware, async (req, res) => {
  try {
    const records = await db.select('temp_uploads', { session_id: req.params.sessionId, owner_id: req.user.id });
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route   DELETE /api/imagekit/temp-upload/:fileId
router.delete('/temp-upload/:fileId', authMiddleware, async (req, res) => {
  try {
    const record = await db.selectFirst('temp_uploads', { imagekit_file_id: req.params.fileId, owner_id: req.user.id });
    if (!record) return res.status(404).json({ message: 'Not found or unauthorized' });
    
    if (imagekit) {
      await imagekit.files.delete(req.params.fileId);
    }
    await db.delete('temp_uploads', record.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// @route   DELETE /api/imagekit/temp/:sessionId
router.delete('/temp/:sessionId', authMiddleware, async (req, res) => {
  try {
    const records = await db.select('temp_uploads', { session_id: req.params.sessionId, owner_id: req.user.id });
    if (!imagekit) throw new Error("ImageKit not initialized");
    
    for (const record of records) {
      try {
        await imagekit.files.delete(record.imagekit_file_id);
      } catch(e) {
         console.error('Failed to delete file from IK:', e);
      }
      await db.delete('temp_uploads', record.id);
    }
    res.json({ message: 'Temporary uploads deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
