// ระบบ Login ด้วย Supabase Auth (ฝั่ง server — Express middleware)
// - POST /api/auth/login  { identifier (อีเมลหรือ username), password } → ตั้ง cookie httpOnly
// - POST /api/auth/logout → ลบ cookie + เพิกถอน refresh token
// - GET  /api/auth/me     → ข้อมูลผู้ใช้ที่ login อยู่
// - authenticate: อ่าน cookie → ตรวจ token กับ Supabase (cache) → refresh อัตโนมัติเมื่อหมดอายุ
//   → ตั้ง req.user และ req.db (store ที่ query ในนามผู้ใช้ เพื่อให้ RLS ทำงาน)
// - requireApiAuth / pageGuard: กันผู้ที่ยังไม่ login ไม่ให้เรียก API / เปิดหน้าแอป
// ถ้าไม่ได้ตั้งค่า Supabase (โหมดไฟล์ JSON) ระบบ login จะปิดอยู่ ทุกคนเข้าได้เหมือนเดิม
const path = require('path');
const db = require('./db');

const enabled = db.useSupabase;
const ACCESS_COOKIE = 'mms_access';
const REFRESH_COOKIE = 'mms_refresh';
const COOKIE_MAX_AGE = 30 * 24 * 3600; // วินาที — อายุ cookie (access token เองหมดอายุ ~1 ชม. แล้ว refresh ให้)
const VERIFY_TTL = 5 * 60 * 1000;      // cache ผลตรวจ token 5 นาที
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Cookie ----------
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ข้าม cookie ที่เสีย */ }
  }
  return out;
}
const isSecure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
function cookieStr(req, name, value, maxAge) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`,
    ...(isSecure(req) ? ['Secure'] : []),
  ].join('; ');
}
function setSessionCookies(req, res, session) {
  res.append('Set-Cookie', cookieStr(req, ACCESS_COOKIE, session.access_token, COOKIE_MAX_AGE));
  res.append('Set-Cookie', cookieStr(req, REFRESH_COOKIE, session.refresh_token, COOKIE_MAX_AGE));
}
function clearSessionCookies(req, res) {
  res.append('Set-Cookie', cookieStr(req, ACCESS_COOKIE, '', 0));
  res.append('Set-Cookie', cookieStr(req, REFRESH_COOKIE, '', 0));
}

// อ่าน exp จาก JWT โดยไม่ตรวจลายเซ็น (ใช้ตัดสินใจว่าจะ refresh เท่านั้น — การตรวจจริงทำที่ getUser)
function tokenExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return (payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

// ---------- ตรวจ token / refresh (มี cache + รวม request ที่ refresh พร้อมกัน) ----------
const verified = new Map();   // access token → { user, until }
const refreshing = new Map(); // refresh token → Promise<session | null>

function remember(map, key, value, max = 500) {
  if (map.size >= max) map.delete(map.keys().next().value);
  map.set(key, value);
}

function toAppUser(authUser, profile) {
  const meta = authUser.user_metadata || {};
  const username = profile?.username || meta.username || String(authUser.email || '').split('@')[0];
  return {
    id: authUser.id,
    email: authUser.email,
    username,
    displayName: profile?.displayName || meta.display_name || username,
    role: profile?.role || meta.role || 'marketing',
  };
}

async function verifyToken(token) {
  const hit = verified.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const { data, error } = await db.getClient().auth.getUser(token);
  if (error || !data?.user) { verified.delete(token); return null; }
  let profile = null;
  try { profile = await db.forToken(token).profiles.get(data.user.id); } catch (err) {
    console.error('อ่าน profile ไม่สำเร็จ:', err.message);
  }
  const user = toAppUser(data.user, profile);
  const until = Math.min(Date.now() + VERIFY_TTL, tokenExp(token) || Infinity);
  remember(verified, token, { user, until });
  return user;
}

function refreshSession(refreshToken) {
  // Supabase refresh token ใช้ได้ครั้งเดียว — Dashboard ยิง API หลายตัวพร้อมกัน ต้องรวมเป็นการ refresh ครั้งเดียว
  if (!refreshing.has(refreshToken)) {
    const p = db.newAuthClient().auth.refreshSession({ refresh_token: refreshToken })
      .then(({ data, error }) => (error || !data?.session ? null : data.session))
      .catch(() => null);
    remember(refreshing, refreshToken, p, 200);
    setTimeout(() => refreshing.delete(refreshToken), 30000).unref();
  }
  return refreshing.get(refreshToken);
}

async function authenticate(req, res, next) {
  req.user = null;
  req.db = db.forToken(null);
  if (!enabled) return next();
  try {
    const cookies = parseCookies(req);
    let token = cookies[ACCESS_COOKIE];
    const refresh = cookies[REFRESH_COOKIE];
    if (!token && !refresh) return next();

    // หมดอายุแล้ว/ใกล้หมด (เหลือ < 60 วินาที) → refresh
    if (refresh && (!token || tokenExp(token) - Date.now() < 60000)) {
      const session = await refreshSession(refresh);
      if (session) {
        token = session.access_token;
        setSessionCookies(req, res, session);
      } else {
        token = null;
      }
    }
    const user = token ? await verifyToken(token) : null;
    if (!user) {
      clearSessionCookies(req, res);
      return next();
    }
    req.user = user;
    req.accessToken = token;
    req.db = db.forToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

// ---------- Guards ----------
const PUBLIC_API = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me']);
function requireApiAuth(req, res, next) {
  if (!enabled || req.user || PUBLIC_API.has(req.path)) return next();
  res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน', code: 'UNAUTHENTICATED' });
}

// หน้าแอป (/, /index.html) และไฟล์แนบ (/uploads) ต้อง login; /login ถ้า login แล้วส่งกลับหน้าแรก
function pageGuard(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const p = req.path;
  if (p === '/login' || p === '/login.html') {
    if (enabled && req.user) return res.redirect('/');
    return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
  }
  if (!enabled || req.user) return next();
  if (p === '/' || p === '/index.html') return res.redirect('/login');
  if (p.startsWith('/uploads/')) return res.status(401).send('กรุณาเข้าสู่ระบบก่อน');
  next();
}

// ---------- Login / Logout routes ----------
// กันเดารหัสผ่าน: ผิดเกิน 10 ครั้งใน 15 นาที (ต่อ IP + บัญชี) ระงับชั่วคราว
const FAIL_WINDOW = 15 * 60 * 1000;
const FAIL_LIMIT = 10;
const failures = new Map();
const failKey = (req, id) => `${req.ip}|${id}`;
function tooManyFailures(key) {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > FAIL_WINDOW) { failures.delete(key); return false; }
  return f.count >= FAIL_LIMIT;
}
function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > FAIL_WINDOW) remember(failures, key, { first: Date.now(), count: 1 }, 2000);
  else f.count++;
}

async function resolveEmail(identifier) {
  if (identifier.includes('@')) return identifier.toLowerCase();
  const { data, error } = await db.getClient().rpc('login_email', { p_identifier: identifier });
  if (error) {
    console.error('แปลง username เป็นอีเมลไม่สำเร็จ (รัน supabase/schema.sql แล้วหรือยัง?):', error.message);
    return null;
  }
  return data || null;
}

function registerRoutes(app) {
  app.post('/api/auth/login', async (req, res, next) => {
    try {
      if (!enabled) return res.status(400).json({ error: 'ระบบ Login ยังไม่เปิดใช้งาน (ยังไม่ได้ตั้งค่า Supabase ใน .env.local)' });
      const identifier = String(req.body?.identifier ?? req.body?.email ?? '').trim().slice(0, 200);
      const password = String(req.body?.password ?? '');
      if (!identifier || !password) return res.status(400).json({ error: 'กรุณากรอกอีเมล/ชื่อผู้ใช้ และรหัสผ่าน' });

      const key = failKey(req, identifier.toLowerCase());
      if (tooManyFailures(key)) return res.status(429).json({ error: 'เข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' });

      const email = await resolveEmail(identifier);
      const { data, error } = email
        ? await db.newAuthClient().auth.signInWithPassword({ email, password })
        : { data: null, error: { message: 'unknown username' } };
      if (error || !data?.session) {
        recordFailure(key);
        const unconfirmed = /not confirmed/i.test(error?.message || '');
        return res.status(401).json({ error: unconfirmed ? 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล' : 'อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง' });
      }
      failures.delete(key);
      setSessionCookies(req, res, data.session);
      const user = await verifyToken(data.session.access_token);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = req.accessToken || parseCookies(req)[ACCESS_COOKIE];
    clearSessionCookies(req, res);
    if (enabled && token) {
      verified.delete(token);
      // เพิกถอน refresh token ของ session นี้ (best effort)
      const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, '');
      const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SECRET_KEY;
      fetch(`${url}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    res.status(204).end();
  });

  app.get('/api/auth/me', (req, res) => {
    if (!enabled) return res.json({ user: null, authEnabled: false });
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน', code: 'UNAUTHENTICATED' });
    res.json({ user: req.user, authEnabled: true });
  });
}

module.exports = { enabled, authenticate, requireApiAuth, pageGuard, registerRoutes };
