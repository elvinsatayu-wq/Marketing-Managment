// ย้ายข้อมูลเดิมจาก data/tasks.json, data/media.json และ data/budgets.json ขึ้น Supabase
// ใช้: npm run db:migrate   (เพิ่ม/ทับตาม id — รันซ้ำได้ ไม่สร้างข้อมูลซ้ำ, ไม่ลบข้อมูลที่มีอยู่แล้วใน Supabase)
//
// สิทธิ์การเขียน (RLS ใน supabase/schema.sql อนุญาตเฉพาะผู้ที่ login):
// - มี SUPABASE_SECRET_KEY → เขียนได้เลย (ข้อมูลเก่าไม่มีผู้สร้าง = created_by ว่าง)
// - ไม่มี → login ด้วย MIGRATE_EMAIL + MIGRATE_PASSWORD ใน .env.local แล้วบันทึกในนามบัญชีนั้น
//   (รายการที่ไม่มีผู้สร้างจะถูกระบุเป็นบัญชีนั้น เพราะ RLS บังคับ created_by = ผู้ที่ login)
const fs = require('fs');
const db = require('../db');

if (!db.useSupabase) {
  console.error('ยังไม่ได้ตั้งค่า Supabase — ใส่ NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY ใน .env.local ก่อน');
  process.exit(1);
}

const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);

async function storesForMigration() {
  if (db.hasSecretKey) return { stores: db, userId: null, label: 'secret key' };
  const email = process.env.MIGRATE_EMAIL;
  const password = process.env.MIGRATE_PASSWORD;
  if (!email || !password) {
    throw new Error('ไม่มี SUPABASE_SECRET_KEY — ใส่ MIGRATE_EMAIL และ MIGRATE_PASSWORD (บัญชีที่ใช้ login แอป) ใน .env.local เพื่อย้ายข้อมูลในนามบัญชีนั้น');
  }
  const { data, error } = await db.newAuthClient().auth.signInWithPassword({ email, password });
  if (error || !data?.session) throw new Error(`login ด้วย ${email} ไม่สำเร็จ: ${error?.message || 'ไม่มี session'}`);
  return { stores: db.forToken(data.session.access_token), userId: data.user.id, label: email };
}

(async () => {
  const { stores, userId, label } = await storesForMigration();
  const own = (x) => (userId ? { ...x, createdBy: x.createdBy || userId, updatedBy: userId } : x);

  const tasks = read(db.FILES.tasks).map(own);
  const media = read(db.FILES.media).map((m) => own({
    ...m,
    status: m.status || (m.postDate < new Date().toISOString().slice(0, 10) ? 'posted' : 'pending'),
  }));
  console.log(`ปลายทาง: ${db.backend} (ในนาม ${label})`);
  console.log(`กิจกรรม: ${await stores.tasks.upsertMany(tasks)} รายการ`);
  console.log(`แผนสื่อ: ${await stores.media.upsertMany(media)} รายการ`);
  const budgets = read(db.FILES.budgets).filter((b) => b && /^\d{4}-\d{2}$/.test(b.month) && Number(b.amount) >= 0);
  await stores.budgets.apply(budgets.map((b) => ({ month: b.month, amount: Number(b.amount), updatedAt: b.updatedAt, updatedBy: userId || b.updatedBy })));
  console.log(`งบรายเดือน: ${budgets.length} เดือน`);
  console.log('ย้ายข้อมูลเรียบร้อย (ไฟล์ใน data/ ยังอยู่เป็นสำรอง)');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
