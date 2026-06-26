const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');
const firebaseAdmin = require('../config/firebase');

function cleanPhone(phone) {
  const cleaned = phone.replace(/[\s\-\+]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return cleaned.slice(2);
  return cleaned;
}

// @route   POST /api/users/switch-to-owner
// @desc    Upgrade a user to owner role immediately
// @access  Private
router.post('/switch-to-owner', authMiddleware, async (req, res) => {
  try {
    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({ is_owner: true })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) {
      console.error('Error switching to owner:', error);
      return res.status(500).json({ message: 'Failed to switch to owner role.' });
    }

    res.json({ message: 'Successfully switched to owner mode.', user: updatedUser });
  } catch (err) {
    console.error('Server error switching to owner:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/payment-info
// @desc    Check if owner payment info exists
// @access  Private
router.get('/payment-info', authMiddleware, async (req, res) => {
  try {
    const { data: paymentInfo, error } = await supabase
      .from('owner_payment_info')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching payment info:', error);
      return res.status(500).json({ message: 'Failed to fetch payment info' });
    }

    if (!paymentInfo) {
      return res.status(404).json({ exists: false });
    }

    res.json({ exists: true, data: paymentInfo });
  } catch (err) {
    console.error('Server error fetching payment info:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/users/payment-info
// @desc    Save owner payment info
// @access  Private
router.post('/payment-info', authMiddleware, async (req, res) => {
  const { accountHolderName, bankAccountNumber, ifscCode, upiId } = req.body;

  if (!accountHolderName || !bankAccountNumber || !ifscCode) {
    return res.status(400).json({ message: 'Missing required payment info fields' });
  }

  try {
    const { data: existing } = await supabase
      .from('owner_payment_info')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ message: 'Payment info already exists for this user.' });
    }

    const { data: paymentInfo, error } = await supabase
      .from('owner_payment_info')
      .insert({
        user_id: req.user.id,
        account_holder_name: accountHolderName,
        bank_account_number: bankAccountNumber,
        ifsc_code: ifscCode,
        upi_id: upiId || null,
        bank_verified: false,
        verification_status: 'pending'
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving payment info:', error);
      return res.status(500).json({ message: 'Failed to save payment info' });
    }

    res.status(201).json({ message: 'Payment info saved successfully', data: paymentInfo });
  } catch (err) {
    console.error('Server error saving payment info:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/me
// @desc    Get authenticated user profile
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('full_name, email, phone, firebase_uid, is_owner, is_tenant, email_verified, phone_verified, created_at')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/users/me
// @desc    Update user profile
// @access  Private
router.put('/me', authMiddleware, async (req, res) => {
  const { full_name, email, phone } = req.body;
  
  try {
    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) {
      updates.email = email.toLowerCase();
      updates.email_verified = true; // Auto-verify upon sync
    }
    if (phone !== undefined) {
      updates.phone = phone;
      updates.phone_verified = true; // Auto-verify upon sync
    }

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user.id)
      .select('full_name, email, phone, firebase_uid, is_owner, is_tenant, email_verified, phone_verified, created_at')
      .single();

    if (error) {
      console.error('Error updating profile:', error);
      return res.status(500).json({ message: 'Failed to update profile' });
    }

    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    console.error('Server error updating profile:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/users/check-email-change
// @desc    Validate email uniqueness before sending verification
// @access  Private
router.post('/check-email-change', authMiddleware, async (req, res) => {
  const { newEmail } = req.body;
  if (!newEmail) return res.status(400).json({ message: 'Email required' });

  try {
    // 1. Check database
    const { data: dbUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', newEmail.toLowerCase())
      .neq('id', req.user.id)
      .maybeSingle();

    if (dbUser) {
      return res.status(400).json({ message: "This email address is already in use." });
    }

    // 2. Check Firebase
    try {
      await firebaseAdmin.auth().getUserByEmail(newEmail.toLowerCase());
      return res.status(400).json({ message: "This email address is already in use." });
    } catch(err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }

    return res.json({ available: true });
  } catch(err) {
    console.error('Check email change error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/users/check-phone-change
// @desc    Validate phone uniqueness before sending OTP
// @access  Private
router.post('/check-phone-change', authMiddleware, async (req, res) => {
  const { newPhone } = req.body;
  if (!newPhone) return res.status(400).json({ message: 'Phone required' });

  const cleanedPhone = cleanPhone(newPhone);
  const formattedPhone = cleanedPhone.length === 10 ? `+91${cleanedPhone}` : `+${cleanedPhone}`;

  try {
    // 1. Check database
    const { data: dbUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone', cleanedPhone)
      .neq('id', req.user.id)
      .maybeSingle();

    if (dbUser) {
      return res.status(400).json({ message: "This phone number is already in use." });
    }

    // 2. Check Firebase
    try {
      await firebaseAdmin.auth().getUserByPhoneNumber(formattedPhone);
      return res.status(400).json({ message: "This phone number is already in use." });
    } catch(err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }

    return res.json({ available: true });
  } catch(err) {
    console.error('Check phone change error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
