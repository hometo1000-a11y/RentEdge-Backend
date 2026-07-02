const express = require('express');
const router = express.Router();

const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'rentedge_secret_jwt_token_key_2026_premium';

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
    authUserId: user.firebase_uid,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    isTenant: user.is_tenant,
    isOwner: user.is_owner,
    emailVerified: user.email_verified,
    phoneVerified: user.phone_verified,
    role: user.is_owner ? 'owner' : 'tenant'
  };
}

function cleanPhone(phone) {
  const cleaned = phone.replace(/[\s\-\+]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return cleaned.slice(2);
  return cleaned;
}

async function getSupabaseAuthUser(accessToken) {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) throw error;
  if (!data?.user) throw new Error('Supabase session missing');
  return data.user;
}

async function loadOrCreateUserFromSupabase({ supabaseUser, fullName, role }) {
  const email = (supabaseUser.email || '').toLowerCase();
  const phone = supabaseUser.user_metadata?.phone ? cleanPhone(String(supabaseUser.user_metadata.phone)) : '';
  const resolvedFullName = fullName || supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.fullName || '';
  const isTenant = role === 'tenant' || role === 'both' || supabaseUser.user_metadata?.role === 'tenant' || !supabaseUser.user_metadata?.role;
  const isOwner = role === 'owner' || role === 'both' || supabaseUser.user_metadata?.role === 'owner';
  const emailVerified = Boolean(supabaseUser.email_confirmed_at || supabaseUser.confirmed_at);

  const searchTerms = [`firebase_uid.eq.${supabaseUser.id}`];
  if (email) searchTerms.push(`email.eq.${email}`);
  if (phone) searchTerms.push(`phone.eq.${phone}`);

  const { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .or(searchTerms.join(','))
    .maybeSingle();

  if (existingUser) {
    const updates = {};
    if (existingUser.firebase_uid !== supabaseUser.id) updates.firebase_uid = supabaseUser.id;
    if (resolvedFullName && existingUser.full_name !== resolvedFullName) updates.full_name = resolvedFullName;
    if (email && existingUser.email !== email) updates.email = email;
    if (phone && existingUser.phone !== phone) updates.phone = phone;
    if (existingUser.email_verified !== emailVerified) updates.email_verified = emailVerified;
    if (existingUser.phone_verified === undefined || existingUser.phone_verified === null) updates.phone_verified = Boolean(phone);
    if (existingUser.is_tenant !== isTenant) updates.is_tenant = isTenant;
    if (existingUser.is_owner !== isOwner) updates.is_owner = isOwner;

    if (Object.keys(updates).length > 0) {
      const { data: updatedUser, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', existingUser.id)
        .select()
        .single();

      if (error) throw error;
      return updatedUser;
    }

    return existingUser;
  }

  const { data: newUser, error: insertError } = await supabase
    .from('users')
    .insert({
      firebase_uid: supabaseUser.id,
      full_name: resolvedFullName,
      email,
      phone,
      is_tenant: isTenant,
      is_owner: isOwner,
      email_verified: emailVerified,
      phone_verified: Boolean(phone)
    })
    .select()
    .single();

  if (insertError) throw insertError;
  return newUser;
}

router.post('/pre-check', async (req, res) => {
  const { email, phone } = req.body;

  if (!email || !phone) {
    return res.status(400).json({ message: 'Email and phone are required for pre-check.' });
  }

  const cleanedPhone = cleanPhone(phone);

  try {
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

    return res.json({ available: true });
  } catch (err) {
    console.error('PRECHECK ERROR:', err);
    return res.status(500).json({
      message: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
    });
  }
});

router.post('/complete-signup', async (req, res) => {
  const { fullName, role, supabaseAccessToken } = req.body;

  if (!supabaseAccessToken) {
    return res.status(400).json({ message: 'Supabase access token is required' });
  }

  try {
    const supabaseUser = await getSupabaseAuthUser(supabaseAccessToken);
    const emailVerified = Boolean(supabaseUser.email_confirmed_at || supabaseUser.confirmed_at);

    if (!emailVerified) {
      return res.status(403).json({ message: 'Email must be verified before completing signup.' });
    }

    const appUser = await loadOrCreateUserFromSupabase({ supabaseUser, fullName, role });

    return res.status(201).json({
      token: generateJWT(appUser),
      user: sanitizeUser(appUser)
    });
  } catch (err) {
  console.error("Complete signup error:", err);

  return res.status(500).json({
    message: err.message,
    code: err.code,
    details: err.details,
    hint: err.hint,
  });
}
});

router.post('/login', async (req, res) => {
  const { supabaseAccessToken } = req.body;

  if (!supabaseAccessToken) {
    return res.status(400).json({ message: 'Supabase access token is required' });
  }

  try {
    const supabaseUser = await getSupabaseAuthUser(supabaseAccessToken);
    const appUser = await loadOrCreateUserFromSupabase({
      supabaseUser,
      fullName: supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.fullName || '',
      role: supabaseUser.user_metadata?.role || 'tenant'
    });

    await supabase
      .from('users')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', appUser.id);

    return res.json({
      token: generateJWT(appUser),
      user: sanitizeUser(appUser)
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error during login' });
  }
});

router.post('/logout', authMiddleware, async (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

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
