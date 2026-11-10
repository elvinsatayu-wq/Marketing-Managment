// ชั้นจัดเก็บข้อมูลกิจกรรม (tasks) และแผนสื่อ (media)
// - ถ้ามี Supabase URL + key ใน .env.local → ใช้ Supabase
// - ถ้าไม่มี → ใช้ไฟล์ data/*.json แบบเดิม
// ทุกฟังก์ชันเป็น async และรับ/คืนอ็อบเจกต์รูปแบบเดิมของแอป (camelCase)
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
if (typeof process.loadEnvFile === 'function') {
  for (const f of ['.env.local', '.env']) {
    try { process.loadEnvFile(path.join(ROOT, f)); } catch { /* ไม่มีไฟล์ */ }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

const DATA_DIR = path.join(ROOT, 'data');
const FILES = {
  tasks: path.join(DATA_DIR, 'tasks.json'),
  media: path.join(DATA_DIR, 'media.json'),
  budgets: path.join(DATA_DIR, 'budgets.json'),
};

// ---------- แปลงแถวในฐานข้อมูล <-> อ็อบเจกต์ของแอป ----------
const iso = (v) => (v ? new Date(v).toISOString() : '');

const taskToRow = (t) => ({
  id: t.id,
  company: t.company || '',
  type: t.type,
  name: t.name,
  objective: t.objective || '',
  owner: t.owner || '',
  owners: t.owners?.length ? t.owners : (t.owner ? [t.owner] : []),
  start_date: t.startDate,
  end_date: t.endDate,
  budget: t.budget || 0,
  budget_items: t.budgetItems || [],
  urgency: t.urgency || 'normal',
  kpi: t.kpi || '',
  kpi_result: t.kpiResult || '',
  status: t.status || 'pending',
  progress: t.progress || '',
  progress_updated_at: t.progressUpdatedAt || null,
  links: t.links || [],
  attachments: t.attachments || [],
  created_by: t.createdBy || null,
  updated_by: t.updatedBy || null,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
});
const rowToTask = (r) => ({
  id: r.id,
  company: r.company || '',
  type: r.type,
  name: r.name,
  objective: r.objective,
  owner: r.owner,
  owners: r.owners || [],
  startDate: r.start_date,
  endDate: r.end_date,
  budget: Number(r.budget) || 0,
  budgetItems: r.budget_items || [],
  urgency: r.urgency,
  kpi: r.kpi,
  kpiResult: r.kpi_result,
  status: r.status,
  progress: r.progress,
  progressUpdatedAt: iso(r.progress_updated_at),
  links: r.links || [],
  attachments: r.attachments || [],
  createdBy: r.created_by || null,
  updatedBy: r.updated_by || null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const mediaToRow = (m) => ({
  id: m.id,
  company: m.company || '',
  name: m.name,
  detail: m.detail || '',
  audience: m.audience || '',
  media_type: m.mediaType,
  channels: m.channels || [],
  purpose: m.purpose,
  status: m.status || 'pending',
  post_date: m.postDate,
  links: m.links || [],
  created_by: m.createdBy || null,
  updated_by: m.updatedBy || null,
  created_at: m.createdAt,
  updated_at: m.updatedAt,
});
const rowToMedia = (r) => ({
  id: r.id,
  company: r.company || '',
  name: r.name,
  detail: r.detail,
  audience: r.audience,
  mediaType: r.media_type,
  channels: r.channels || [],
  purpose: r.purpose,
  status: r.status,
  postDate: r.post_date,
  links: r.links || [],
  createdBy: r.created_by || null,
  updatedBy: r.updated_by || null,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const rowToProfile = (r) => ({
  id: r.id,
  email: r.email,
  username: r.username,
  displayName: r.display_name || r.username || r.email,
  role: r.role,
});

// ---------- Supabase ----------
// client พื้นฐาน (ไม่มีผู้ใช้) ใช้กับสคริปต์ / การ login; ตอนให้บริการ API ใช้ client ที่แนบ access token
// ของผู้ใช้ (clientForToken) เพื่อให้ RLS เห็นเป็น role authenticated และ auth.uid() = ผู้ใช้นั้น
const CLIENT_OPTS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let supabaseClient;
function getClient() {
  if (!supabaseClient) {
    const { createClient } = require('@supabase/supabase-js');
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, CLIENT_OPTS);
  }
  return supabaseClient;
}
// client ใหม่ทุกครั้ง (ไม่แชร์ session) — ใช้กับ signInWithPassword / refreshSession
function newAuthClient() {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SUPABASE_KEY, CLIENT_OPTS);
}
function clientForToken(token) {
  const { createClient } = require('@supabase/supabase-js');
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    ...CLIENT_OPTS,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
function supabaseError(table, error) {
  const missing = error.code === 'PGRST205' || error.code === '42P01';
  const err = new Error(missing
    ? `ยังไม่มีตาราง "${table}" ใน Supabase — กรุณารัน supabase/schema.sql ใน SQL Editor ก่อน`
    : `บันทึก/อ่านข้อมูลจาก Supabase ไม่สำเร็จ: ${error.message}`);
  err.status = 500;
  return err;
}

function supabaseStore(table, toRow, fromRow, client = getClient()) {

  const fail = (error) => { throw supabaseError(table, error); };
  const PAGE = 1000;

  return {
    async list() {
      const out = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client.from(table).select('*').order('created_at').range(from, from + PAGE - 1);
        if (error) fail(error);
        out.push(...data);
        if (data.length < PAGE) break;
      }
      return out.map(fromRow);
    },
    async get(id) {
      const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
      if (error) {
        if (error.code === '22P02') return null; // id ไม่ใช่ uuid
        fail(error);
      }
      return data ? fromRow(data) : null;
    },
    async insert(item) {
      const { data, error } = await client.from(table).insert(toRow(item)).select().single();
      if (error) fail(error);
      return fromRow(data);
    },
    async update(id, item) {
      const { id: _id, created_at, ...row } = toRow(item);
      const { data, error } = await client.from(table).update(row).eq('id', id).select().maybeSingle();
      if (error) fail(error);
      return data ? fromRow(data) : null;
    },
    async remove(id) {
      const { data, error } = await client.from(table).delete().eq('id', id).select('id');
      if (error) {
        if (error.code === '22P02') return false;
        fail(error);
      }
      return data.length > 0;
    },
    // ใช้กับสคริปต์ย้ายข้อมูล: เพิ่ม/ทับตาม id
    async upsertMany(items) {
      if (!items.length) return 0;
      const { error } = await client.from(table).upsert(items.map(toRow), { onConflict: 'id' });
      if (error) fail(error);
      return items.length;
    },
  };
}

// ---------- JSON file (fallback) ----------
function jsonStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const load = () => {
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
      console.error(`อ่านไฟล์ข้อมูล ${path.basename(file)} ไม่สำเร็จ:`, err.message);
      return [];
    }
  };
  const save = (items) => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  };
  return {
    saveAll: save,
    async list() { return load(); },
    async get(id) { return load().find((x) => x.id === id) || null; },
    async insert(item) { const items = load(); items.push(item); save(items); return item; },
    async update(id, item) {
      const items = load();
      const idx = items.findIndex((x) => x.id === id);
      if (idx === -1) return null;
      items[idx] = item;
      save(items);
      return item;
    },
    async remove(id) {
      const items = load();
      const idx = items.findIndex((x) => x.id === id);
      if (idx === -1) return false;
      items.splice(idx, 1);
      save(items);
      return true;
    },
    async upsertMany(list) {
      const items = load();
      for (const it of list) {
        const idx = items.findIndex((x) => x.id === it.id);
        if (idx === -1) items.push(it); else items[idx] = it;
      }
      save(items);
      return list.length;
    },
  };
}

// ---------- งบที่ตั้งไว้รายเดือน: [{ month: 'YYYY-MM', amount, updatedAt }] (key = month) ----------
// apply(entries): entries = [{ month, amount (null = ลบการตั้งงบเดือนนั้น), updatedAt }]
const sortByMonth = (list) => list.sort((a, b) => a.month.localeCompare(b.month));

function supabaseBudgets(client = getClient()) {
  const fromRow = (r) => ({ month: r.month, amount: Number(r.amount) || 0, updatedAt: iso(r.updated_at), updatedBy: r.updated_by || null });
  const toRow = (b) => ({ month: b.month, amount: b.amount, updated_at: b.updatedAt || new Date().toISOString(), updated_by: b.updatedBy || null });
  return {
    async list() {
      const { data, error } = await client.from('budgets').select('*').order('month');
      if (error) throw supabaseError('budgets', error);
      return data.map(fromRow);
    },
    async apply(entries) {
      const upserts = entries.filter((b) => b.amount !== null).map(toRow);
      const removes = entries.filter((b) => b.amount === null).map((b) => b.month);
      if (upserts.length) {
        const { error } = await client.from('budgets').upsert(upserts, { onConflict: 'month' });
        if (error) throw supabaseError('budgets', error);
      }
      if (removes.length) {
        const { error } = await client.from('budgets').delete().in('month', removes);
        if (error) throw supabaseError('budgets', error);
      }
    },
  };
}

function jsonBudgets(file) {
  const store = jsonStore(file);
  return {
    async list() { return sortByMonth(await store.list()); },
    async apply(entries) {
      const items = await store.list();
      for (const b of entries) {
        const idx = items.findIndex((x) => x.month === b.month);
        if (b.amount === null) { if (idx !== -1) items.splice(idx, 1); continue; }
        const entry = { month: b.month, amount: b.amount, updatedAt: b.updatedAt || new Date().toISOString(), updatedBy: b.updatedBy || null };
        if (idx === -1) items.push(entry); else items[idx] = entry;
      }
      store.saveAll(sortByMonth(items));
    },
  };
}

// ---------- โปรไฟล์ผู้ใช้ (ตาราง profiles, Supabase เท่านั้น) ----------
function supabaseProfiles(client = getClient()) {
  return {
    async list() {
      const { data, error } = await client.from('profiles').select('*').order('username');
      if (error) throw supabaseError('profiles', error);
      return data.map(rowToProfile);
    },
    async get(id) {
      const { data, error } = await client.from('profiles').select('*').eq('id', id).maybeSingle();
      if (error) throw supabaseError('profiles', error);
      return data ? rowToProfile(data) : null;
    },
  };
}
const noProfiles = { async list() { return []; }, async get() { return null; } };

const tasks = useSupabase ? supabaseStore('tasks', taskToRow, rowToTask) : jsonStore(FILES.tasks);
const media = useSupabase ? supabaseStore('media', mediaToRow, rowToMedia) : jsonStore(FILES.media);
const budgets = useSupabase ? supabaseBudgets() : jsonBudgets(FILES.budgets);
const profiles = useSupabase ? supabaseProfiles() : noProfiles;
const shared = { tasks, media, budgets, profiles };

// ชุด store ที่ทำงานในนามผู้ใช้ (access token) — โหมด JSON ไม่มีผู้ใช้ คืน store เดิม
// cache ตาม token (token เปลี่ยนทุก ~1 ชม. ตอน refresh) จำกัดขนาดกันหน่วยความจำโต
const userStores = new Map();
function forToken(token) {
  if (!useSupabase || !token) return shared;
  let s = userStores.get(token);
  if (!s) {
    const c = clientForToken(token);
    s = {
      tasks: supabaseStore('tasks', taskToRow, rowToTask, c),
      media: supabaseStore('media', mediaToRow, rowToMedia, c),
      budgets: supabaseBudgets(c),
      profiles: supabaseProfiles(c),
    };
    if (userStores.size >= 200) userStores.delete(userStores.keys().next().value);
    userStores.set(token, s);
  }
  return s;
}

module.exports = {
  tasks,
  media,
  budgets,
  profiles,
  forToken,
  getClient,
  newAuthClient,
  hasSecretKey: Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  backend: useSupabase ? `Supabase (${SUPABASE_URL})` : 'ไฟล์ JSON (data/)',
  useSupabase,
  FILES,
};
