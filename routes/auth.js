const express = require('express');
const router = express.Router();

const jwt = require('jsonwebtoken');
const { supabase, db } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');
const firebaseAdmin = require('../config/firebase');


const JWT_SECRET = process.env.JWT_SECRET || 'rentedge_secret_jwt_token_key_2026_premium';

// ─── Helpers ──────────────────────────────────────────────────────

function generateJWT(user) {
  const payload = {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    isTenant: user.is_tenant,
    isOwner: user.is_owner
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function sanitizeUser(user) {
  return {
    id: user.id,
    firebaseUid: user.firebase_uid,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    isTenant: user.is_tenant,
    isOwner: user.is_owner,
    emailVerified: user.email_verified,
    phoneVerified: user.phone_verified,
    // Derive legacy "role" for frontend compatibility
    role: user.is_owner ? 'owner' : 'tenant'
  };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
  // Accept 10 digit Indian numbers (with or without +91 prefix)
  const cleaned = phone.replace(/[\s\-\+]/g, '');
  return /^(91)?[6-9]\d{9}$/.test(cleaned);
}

function cleanPhone(phone) {
  const cleaned = phone.replace(/[\s\-\+]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return cleaned.slice(2);
  return cleaned;
}

// ─── POST /api/auth/pre-check ───────────────────────────────────────
// Strict uniqueness check for Signup Validation and Firebase Validation
router.post('/pre-check', async (req, res) => {
  const { email, phone } = req.body;

  if (!email || !phone) {
    return res.status(400).json({ message: 'Email and phone are required for pre-check.' });
  }

  const cleanedPhone = cleanPhone(phone);
  const formattedPhone = cleanedPhone.length === 10 ? `+91${cleanedPhone}` : `+${cleanedPhone}`;

  try {
    // 1. Signup Validation - Database Check
    const { data: emailUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (emailUser) {
      return res.json({ status: 'exists', message: 'This email address is already registered.' });
    }

    const { data: phoneUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone', cleanedPhone)
      .maybeSingle();

    if (phoneUser) {
      return res.json({ status: 'exists', message: 'This phone number is already registered.' });
    }

    // 2. Firebase Validation
    try {
      await firebaseAdmin.auth().getUserByEmail(email.toLowerCase());
      // If found:
      return res.json({ status: 'exists', message: 'This email address is already in use.' });
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }

    try {
      await firebaseAdmin.auth().getUserByPhoneNumber(formattedPhone);
      // If found:
      return res.json({ status: 'exists', message: 'This phone number is already in use.' });
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }

    // If neither exists anywhere, it's available
    return res.json({ available: true });

  } catch (err) {
    console.error('Pre-check error:', err);
    res.status(500).json({ message: 'Server error during availability check' });
  }
});

// ─── POST /api/auth/complete-signup ───────────────────────────────
// Single User Creation Point
router.post('/complete-signup', async (req, res) => {
  const { fullName, role, firebaseIdToken } = req.body;

  if (!fullName || !role || !firebaseIdToken) {
    return res.status(400).json({ message: 'Missing required signup fields' });
  }

  try {
    // 1. Verify Firebase Token
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(firebaseIdToken);
    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email || '';
    const phone = decodedToken.phone_number || '';
    const emailVerified = decodedToken.email_verified === true;
    const phoneVerified = !!phone;

    // 2. Strict Backend Verification Check
    if (!emailVerified || !phoneVerified || !email) {
      return res.status(403).json({ 
        message: 'Registration incomplete. Both email and phone must be verified.' 
      });
    }

    // 3. Duplicate Protection Check
    const cleanedPhone = cleanPhone(phone);
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .or(`firebase_uid.eq.${firebaseUid},email.eq.${email.toLowerCase()},phone.eq.${cleanedPhone}`)
      .maybeSingle();

    if (existingUser) {
      // If user already exists, seamlessly log them in instead of throwing an error
      return res.json({
        token: generateJWT(existingUser),
        user: sanitizeUser(existingUser),
        message: 'Account already existed. Logged in successfully.'
      });
    }

    // 4. Create Database Record
    const isTenant = role === 'tenant' || role === 'both';
    const isOwner = role === 'owner' || role === 'both';

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        firebase_uid: firebaseUid,
        full_name: fullName,
        email: email.toLowerCase(),
        phone: cleanedPhone,
        is_tenant: isTenant,
        is_owner: isOwner,
        email_verified: true,
        phone_verified: true
      })
      .select()
      .single();

    if (insertError) {
      console.error('User insert error:', insertError);
      return res.status(500).json({ message: 'Failed to create user profile: ' + insertError.message });
    }

    // 5. Generate JWT and return session
    const token = generateJWT(newUser);

    res.status(201).json({
      token,
      user: sanitizeUser(newUser)
    });
  } catch (err) {
    console.error('Complete signup error:', err);
    res.status(500).json({ message: 'Server error during signup completion' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { firebaseIdToken } = req.body;

  if (!firebaseIdToken) {
    return res.status(400).json({ message: 'Firebase token is required' });
  }

  try {
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(firebaseIdToken);
    const firebaseUid = decodedToken.uid;

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('firebase_uid', firebaseUid)
      .maybeSingle();

    if (!user) {
      // Seamless migration link for users who haven't updated to Firebase yet
      const { data: legacyUser } = await supabase
        .from('users')
        .select('*')
        .eq('email', decodedToken.email?.toLowerCase())
        .maybeSingle();
        
      if (legacyUser && !legacyUser.firebase_uid) {
        const { data: linkedUser } = await supabase
          .from('users')
          .update({ firebase_uid: firebaseUid })
          .eq('id', legacyUser.id)
          .select()
          .single();
          
        if (linkedUser) {
           return res.json({
             token: generateJWT(linkedUser),
             user: sanitizeUser(linkedUser)
           });
        }
      }
      return res.status(401).json({ message: 'No profile found for this account. Please sign up.' });
    }

    // Update last login timestamp
    await supabase
      .from('users')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', user.id);

    // Generate JWT
    const token = generateJWT(user);

    res.json({
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────
router.post('/logout', authMiddleware, async (req, res) => {
  // JWT is stateless — logout handled client-side.
  res.json({ message: 'Logged out successfully' });
});

// ─── POST /api/auth/lookup-email ───────────────────────────────────
// Resolves an identifier (phone or email) to an email for Firebase login
router.post('/lookup-email', async (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ message: 'Identifier required' });

  try {
    const isEmail = validateEmail(identifier);
    let queryEmail = identifier.toLowerCase();

    if (!isEmail) {
      const cleanedPhone = cleanPhone(identifier);
      const { data: user } = await supabase
        .from('users')
        .select('email')
        .eq('phone', cleanedPhone)
        .maybeSingle();
      
      if (!user) {
        return res.status(404).json({ message: 'Account not found for this phone number' });
      }
      queryEmail = user.email;
    }

    res.json({ email: queryEmail });
  } catch (err) {
    console.error('Lookup email error:', err);
    res.status(500).json({ message: 'Server error during lookup' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(sanitizeUser(user));
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
