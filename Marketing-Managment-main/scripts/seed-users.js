// สร้างบัญชีผู้ใช้เริ่มต้น 4 บัญชี (Marketing 1 - 4) ใน Supabase Auth + ตาราง profiles
// ใช้: npm run seed:users                      สร้างบัญชีที่ยังไม่มี (บัญชีที่มีอยู่แล้วไม่แตะรหัสผ่าน)
//      npm run seed:users -- --reset-password   ตั้งรหัสผ่านของทั้ง 4 บัญชีกลับเป็นค่าเริ่มต้น
// ต้องมี SUPABASE_SECRET_KEY ใน .env.local (การสร้างผู้ใช้ใช้ Admin API ซึ่ง publishable/anon key ทำไม่ได้)
// รหัสผ่านเริ่มต้น: SEED_USER_PASSWORD ใน .env.local หรือ "Marketing@2026" — ควรเปลี่ยนหลัง login ครั้งแรก
const fs = require('fs');
const path = require('path');

// โหลด .env.local / .env จากโฟลเดอร์โปรเจกต์ (อิงตำแหน่งสคริปต์ ไม่ขึ้นกับโฟลเดอร์ที่รันคำสั่ง)
// ต้องทำก่อน require('../db') เพื่อให้ db.js เห็นค่า; ค่าที่ตั้งไว้ใน environment อยู่แล้วจะไม่ถูกเขียนทับ
const PROJECT_ROOT = path.resolve(__dirname, '..');
const loadedEnvFiles = [];
for (const name of ['.env.local', '.env']) {
  const file = path.join(PROJECT_ROOT, name);
  if (!fs.existsSync(file)) continue;
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(file);
  } else {
    // Node < 20.12 ไม่มี process.loadEnvFile → parse แบบ KEY=VALUE เอง
    for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let value = m[2];
      const q = value[0];
      if ((q === '"' || q === "'") && value.endsWith(q) && value.length >= 2) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '');
      process.env[m[1]] = value;
    }
  }
  loadedEnvFiles.push(file);
}
if (!loadedEnvFiles.length) {
  console.error(`ไม่พบไฟล์ .env.local ที่ ${path.join(PROJECT_ROOT, '.env.local')} — คัดลอกจาก .env.example แล้วใส่ค่า Supabase`);
  process.exit(1);
}
const missingEnv = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY']
  .filter((k) => !(process.env[k] || '').trim() && !(k === 'NEXT_PUBLIC_SUPABASE_URL' && process.env.SUPABASE_URL));
if (missingEnv.length) {
  console.error(`โหลดจาก ${loadedEnvFiles.join(', ')} แล้ว แต่ไม่พบค่า: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const db = require('../db');

const DOMAIN = process.env.SEED_USER_DOMAIN || 'domain.com';
const PASSWORD = process.env.SEED_USER_PASSWORD || 'Marketing@2026';
const RESET = process.argv.includes('--reset-password');

const USERS = [1, 2, 3, 4].map((n) => ({
  email: `marketing${n}@${DOMAIN}`,
  username: `marketing${n}`,
  displayName: `Marketing ${n}`,
  role: 'marketing',
}));

if (!db.useSupabase) {
  console.error('ยังไม่ได้ตั้งค่า Supabase — ใส่ NEXT_PUBLIC_SUPABASE_URL และ key ใน .env.local ก่อน');
  process.exit(1);
}
if (!db.hasSecretKey) {
  console.error([
    'ต้องใช้ SUPABASE_SECRET_KEY ใน .env.local เพื่อสร้างผู้ใช้ (Supabase Dashboard → Project Settings → API Keys → Secret keys)',
    'หรือสร้างเองที่ Supabase Dashboard → Authentication → Users → Add user (ติ๊ก Auto Confirm User)',
    `  อีเมล: ${USERS.map((u) => u.email).join(', ')}`,
    '  ระบบจะสร้าง profile ให้อัตโนมัติจาก trigger ใน supabase/schema.sql (username = ส่วนหน้า @)',
  ].join('\n'));
  process.exit(1);
}
if (PASSWORD.length < 8) {
  console.error('SEED_USER_PASSWORD ต้องยาวอย่างน้อย 8 ตัวอักษร');
  process.exit(1);
}

async function findUserByEmail(admin, email) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`อ่านรายชื่อผู้ใช้ไม่สำเร็จ: ${error.message}`);
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit || data.users.length < 1000) return hit || null;
  }
}

(async () => {
  const client = db.getClient();
  const admin = client.auth.admin;
  console.log(`ปลายทาง: ${db.backend}`);

  for (const u of USERS) {
    const metadata = { username: u.username, display_name: u.displayName, role: u.role };
    let user = await findUserByEmail(admin, u.email);
    let action;
    if (!user) {
      const { data, error } = await admin.createUser({
        email: u.email,
        password: PASSWORD,
        email_confirm: true, // ไม่ต้องยืนยันอีเมล (และไม่ส่งอีเมลออกไปที่ domain จริง)
        user_metadata: metadata,
      });
      if (error) throw new Error(`สร้าง ${u.email} ไม่สำเร็จ: ${error.message}`);
      user = data.user;
      action = 'สร้างใหม่';
    } else {
      const { error } = await admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, ...metadata },
        ...(RESET ? { password: PASSWORD } : {}),
      });
      if (error) throw new Error(`อัปเดต ${u.email} ไม่สำเร็จ: ${error.message}`);
      action = RESET ? 'มีอยู่แล้ว (ตั้งรหัสผ่านใหม่)' : 'มีอยู่แล้ว (ไม่เปลี่ยนรหัสผ่าน)';
    }

    // trigger สร้าง profile ให้แล้ว แต่ upsert ซ้ำเพื่อให้ชื่อ/role ตรงตามนี้เสมอ (secret key ข้าม RLS)
    const { error: pErr } = await client.from('profiles').upsert({
      id: user.id,
      email: u.email,
      username: u.username,
      display_name: u.displayName,
      role: u.role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (pErr) {
      const missing = pErr.code === 'PGRST205' || pErr.code === '42P01';
      throw new Error(missing ? 'ยังไม่มีตาราง profiles — รัน supabase/schema.sql ใน SQL Editor ก่อน' : `บันทึก profile ${u.email} ไม่สำเร็จ: ${pErr.message}`);
    }
    console.log(`  ${u.displayName.padEnd(12)} ${u.email.padEnd(26)} username: ${u.username.padEnd(11)} ${action}`);
  }

  console.log(`\nรหัสผ่านเริ่มต้น: ${PASSWORD}${RESET ? '' : ' (เฉพาะบัญชีที่สร้างใหม่)'}`);
  console.log('เข้าสู่ระบบได้ด้วยอีเมลหรือ username — ควรเปลี่ยนรหัสผ่านหลังใช้งานครั้งแรก');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
