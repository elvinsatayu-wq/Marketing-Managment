const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db'); // โหลด .env.local ด้วย
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB ต่อไฟล์
const MAX_FILES = 10;
const MAX_LINKS = 20;
const MAX_BUDGET_ITEMS = 50;
const NEAR_DUE_DAYS = 7;

const TASK_TYPES = ['marketing', 'content', 'graphic', 'it']; // การตลาด / คอนเทนต์ / กราฟฟิก / ไอที (เลือกได้หลายข้อ)
const URGENCIES = ['urgent', 'normal'];
const STATUSES = ['pending', 'in_progress', 'done'];
const KPI_RESULTS = ['pass', 'fail'];
const COMPANIES = ['biowood', 'woodmate', 'econic']; // ใช้ร่วมกันทั้งกิจกรรมและแผนสื่อ

// Media Planner
const MEDIA_TYPES = ['image', 'video', 'offline'];
const MEDIA_CHANNELS = ['facebook', 'instagram', 'tiktok', 'website', 'billboard'];
const MEDIA_PURPOSES = ['sale', 'value', 'news'];
const MEDIA_STATUSES = ['pending', 'producing', 'scheduled', 'posted']; // In plan / In Production / Scheduled / Published

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Storage ----------

// กิจกรรม แผนสื่อ และงบที่ตั้งไว้รายเดือน อยู่ใน db.js (Supabase หรือไฟล์ JSON)
// d = req.db (store ที่ query ในนามผู้ใช้ที่ login — ตั้งโดย auth.authenticate)
const loadTasks = (d) => d.tasks.list();
// แผนสื่อเก่าที่ยังไม่มี status: เลยวันโพสต์แล้ว = Published, ยังไม่ถึง = In plan
const withMediaStatus = (m) => (MEDIA_STATUSES.includes(m.status) ? m : { ...m, status: m.postDate < todayStr() ? 'posted' : 'pending' });
const loadMedia = async (d) => (await d.media.list()).map(withMediaStatus);
const loadBudgets = (d) => d.budgets.list();

// ---------- ผู้สร้าง / ผู้แก้ไขล่าสุด ----------
// ชื่อที่แสดงของผู้ใช้ (id → displayName) cache 60 วินาที — ใช้เติม createdByName / updatedByName ตอนตอบ API
let nameCache = { at: 0, map: new Map() };
async function loadNames(req) {
  if (!auth.enabled) return nameCache.map;
  if (Date.now() - nameCache.at > 60000) {
    try {
      const list = await req.db.profiles.list();
      nameCache = { at: Date.now(), map: new Map(list.map((p) => [p.id, p.displayName])) };
    } catch (err) {
      console.error('อ่านรายชื่อผู้ใช้ไม่สำเร็จ:', err.message);
    }
  }
  if (req.user && !nameCache.map.has(req.user.id)) nameCache.map.set(req.user.id, req.user.displayName);
  return nameCache.map;
}
const withNames = (names) => (item) => ({
  ...item,
  createdBy: item.createdBy || null,
  updatedBy: item.updatedBy || null,
  createdByName: (item.createdBy && names.get(item.createdBy)) || '',
  updatedByName: (item.updatedBy && names.get(item.updatedBy)) || '',
});
const userId = (req) => (req.user ? req.user.id : null);

// ---------- Helpers ----------

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

// สถานะตามกำหนดเวลา: done / overdue / near_due / on_track
function dueState(task, today = todayStr()) {
  if (task.status === 'done') return 'done';
  const left = daysBetween(today, task.endDate);
  if (left < 0) return 'overdue';
  if (left <= NEAR_DUE_DAYS) return 'near_due';
  return 'on_track';
}

function withComputed(task) {
  return { ...task, dueState: dueState(task) };
}

function sortTasks(tasks) {
  return tasks.slice().sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === 'urgent' ? -1 : 1;
    const aDone = a.status === 'done', bDone = b.status === 'done';
    if (aDone !== bDone) return aDone ? 1 : -1;
    return a.endDate.localeCompare(b.endDate);
  });
}

// งานที่ช่วงเวลาทับซ้อนกับช่วงที่กรอง
function filterByRange(tasks, from, to) {
  return tasks.filter((t) => (!from || t.endDate >= from) && (!to || t.startDate <= to));
}

// รับเฉพาะ http/https (กัน javascript: ฯลฯ) ถ้าไม่ใส่ scheme จะเติม https:// ให้
function normalizeUrl(s) {
  let str = String(s || '').trim();
  if (!str) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(str)) str = `https://${str}`;
  try {
    const u = new URL(str);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function parseLinks(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = raw.trim() ? JSON.parse(raw) : [];
    } catch {
      return { error: 'รูปแบบ Link งานไม่ถูกต้อง' };
    }
  }
  if (!Array.isArray(list)) return { error: 'รูปแบบ Link งานไม่ถูกต้อง' };
  if (list.length > MAX_LINKS) return { error: `ใส่ Link งานได้สูงสุด ${MAX_LINKS} รายการ` };
  const links = [];
  for (const item of list) {
    const label = String(item?.label ?? '').trim().slice(0, 200);
    if (!String(item?.url ?? '').trim()) continue; // แถวที่ไม่มี URL ข้ามไป
    const url = normalizeUrl(item.url);
    if (!url || url.length > 2000) return { error: `Link งานไม่ถูกต้อง: ${String(item.url).slice(0, 100)}` };
    links.push({ label, url });
  }
  return { links };
}

// รายการใช้งบประมาณ: JSON array ของ { detail, amount } (แถวที่ว่างทั้งคู่ข้ามไป)
function parseBudgetItems(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = raw.trim() ? JSON.parse(raw) : [];
    } catch {
      return { error: 'รูปแบบรายการใช้งบประมาณไม่ถูกต้อง' };
    }
  }
  if (!Array.isArray(list)) return { error: 'รูปแบบรายการใช้งบประมาณไม่ถูกต้อง' };
  if (list.length > MAX_BUDGET_ITEMS) return { error: `ใส่รายการใช้งบประมาณได้สูงสุด ${MAX_BUDGET_ITEMS} รายการ` };
  const items = [];
  for (const item of list) {
    const detail = String(item?.detail ?? '').trim().slice(0, 300);
    const rawAmount = item?.amount ?? '';
    if (!detail && String(rawAmount).trim() === '') continue;
    if (!detail) return { error: 'กรุณากรอกรายละเอียดของรายการใช้งบประมาณ' };
    const amount = String(rawAmount).trim() === '' ? 0 : Number(rawAmount);
    if (!Number.isFinite(amount) || amount < 0) return { error: `จำนวนเงินของ "${detail}" ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป` };
    items.push({ detail, amount: Math.round(amount * 100) / 100 });
  }
  return { items };
}

const MAX_OWNERS = 20;
// ผู้รับผิดชอบหลายคน: JSON array ของชื่อ (หรือ array) — ตัดช่องว่าง/ตัวซ้ำ
function parseOwners(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return { error: 'รูปแบบผู้รับผิดชอบไม่ถูกต้อง' }; }
  }
  if (!Array.isArray(list)) return { error: 'รูปแบบผู้รับผิดชอบไม่ถูกต้อง' };
  const owners = [...new Set(list.map((o) => String(o ?? '').trim().slice(0, 200)).filter(Boolean))];
  if (owners.length > MAX_OWNERS) return { error: `ใส่ผู้รับผิดชอบได้สูงสุด ${MAX_OWNERS} คน` };
  return { owners };
}

// ประเภทงานหลายข้อ: JSON array (หรือ array) จาก TASK_TYPES — ตัดตัวซ้ำ + เรียงตามลำดับมาตรฐาน
function parseTaskTypes(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = raw.trim() ? JSON.parse(raw) : []; } catch { return { error: 'รูปแบบประเภทงานไม่ถูกต้อง' }; }
  }
  list = [].concat(list ?? []);
  if (list.some((v) => !TASK_TYPES.includes(v))) return { error: 'ประเภทงานไม่ถูกต้อง' };
  return { types: TASK_TYPES.filter((v) => list.includes(v)) };
}

function validateTask(body, partial = false) {
  const errors = [];
  const out = {};
  // ส่ง owners มา → owner (string) = ชื่อทั้งหมดคั่นด้วย ", " เพื่อให้ส่วนที่ใช้ owner เดิมทำงานต่อได้
  if (body.owners !== undefined) {
    const { error, owners } = parseOwners(body.owners);
    if (error) errors.push(error);
    else { out.owners = owners; body = { ...body, owner: owners.join(', ') }; }
  } else if (body.owner !== undefined && body.owner !== '') {
    out.owners = String(body.owner).split(',').map((s) => s.trim()).filter(Boolean);
  }
  const has = (k) => body[k] !== undefined && body[k] !== '';

  const need = ['company', 'name', 'objective', 'startDate', 'endDate', 'budget', 'urgency', 'owner'];
  const missingMsg = { owner: 'กรุณาเพิ่มผู้รับผิดชอบอย่างน้อย 1 คน', company: 'กรุณาเลือกบริษัท' };
  if (!partial) {
    for (const k of need) if (!has(k)) errors.push(missingMsg[k] || `กรุณากรอก ${k}`);
  }

  if (has('company')) {
    if (!COMPANIES.includes(body.company)) errors.push('บริษัทไม่ถูกต้อง');
    else out.company = body.company;
  }
  if (body.types !== undefined || !partial) {
    const { error, types } = parseTaskTypes(body.types);
    if (error) errors.push(error);
    else if (!types.length) errors.push('กรุณาเลือกประเภทงานอย่างน้อย 1 ประเภท');
    else out.types = types;
  }
  for (const k of ['name', 'objective', 'owner']) {
    if (has(k)) out[k] = String(body[k]).trim().slice(0, 1000);
  }
  // KPI เป็นช่องไม่บังคับ ส่งค่าว่างมาเพื่อล้างได้
  if (body.kpi !== undefined) out.kpi = String(body.kpi).trim().slice(0, 2000);
  // ความคืบหน้าของงาน (ไม่บังคับ) ส่งค่าว่างมาเพื่อล้างได้
  if (body.progress !== undefined) out.progress = String(body.progress).trim().slice(0, 2000);
  // สรุป KPI: '' = ยังไม่สรุป
  if (body.kpiResult !== undefined) {
    if (body.kpiResult !== '' && !KPI_RESULTS.includes(body.kpiResult)) errors.push('สรุป KPI ไม่ถูกต้อง');
    else out.kpiResult = body.kpiResult;
  }
  // Link งาน ส่งมาเป็น JSON array ของ { label, url } (ส่ง [] เพื่อล้างได้)
  if (body.links !== undefined) {
    const { error, links } = parseLinks(body.links);
    if (error) errors.push(error);
    else out.links = links;
  }
  for (const k of ['startDate', 'endDate']) {
    if (has(k)) {
      if (!isValidDate(body[k])) errors.push(`รูปแบบวันที่ ${k} ไม่ถูกต้อง`);
      else out[k] = body[k];
    }
  }
  if (has('budget')) {
    const n = Number(body.budget);
    if (!Number.isFinite(n) || n < 0) errors.push('งบประมาณต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    else out.budget = Math.round(n * 100) / 100;
  }
  if (body.budgetItems !== undefined) {
    const { error, items } = parseBudgetItems(body.budgetItems);
    if (error) errors.push(error);
    else out.budgetItems = items;
  }
  if (has('urgency')) {
    if (!URGENCIES.includes(body.urgency)) errors.push('ความเร่งด่วนไม่ถูกต้อง');
    else out.urgency = body.urgency;
  }
  if (has('status')) {
    if (!STATUSES.includes(body.status)) errors.push('สถานะไม่ถูกต้อง');
    else out.status = body.status;
  }
  return { errors, data: out };
}

function sortMedia(items) {
  return items.slice().sort((a, b) => a.postDate.localeCompare(b.postDate) || a.name.localeCompare(b.name, 'th'));
}

function validateMedia(body, partial = false) {
  const errors = [];
  const out = {};
  const has = (k) => body[k] !== undefined && body[k] !== '';

  if (!partial) {
    const need = [['company', 'บริษัท'], ['name', 'ชื่องาน'], ['mediaType', 'ประเภทสื่อ'], ['purpose', 'วัตถุประสงค์ของสื่อ'], ['postDate', 'วันที่กำหนด Post']];
    for (const [k, label] of need) if (!has(k)) errors.push(`กรุณากรอก${label}`);
  }

  if (has('company')) {
    if (!COMPANIES.includes(body.company)) errors.push('บริษัทไม่ถูกต้อง');
    else out.company = body.company;
  }
  if (has('name')) {
    out.name = String(body.name).trim().slice(0, 300);
    if (!out.name) errors.push('กรุณากรอกชื่องาน');
  }
  // รายละเอียดเป็นช่องไม่บังคับ ส่งค่าว่างมาเพื่อล้างได้
  if (body.detail !== undefined) out.detail = String(body.detail).trim().slice(0, 5000);
  // กลุ่มเป้าหมายที่ต้องการสื่อสาร (ไม่บังคับ)
  if (body.audience !== undefined) out.audience = String(body.audience).trim().slice(0, 1000);
  if (body.links !== undefined) {
    const { error, links } = parseLinks(body.links);
    if (error) errors.push(error);
    else out.links = links;
  }
  if (has('mediaType')) {
    if (!MEDIA_TYPES.includes(body.mediaType)) errors.push('ประเภทสื่อไม่ถูกต้อง');
    else out.mediaType = body.mediaType;
  }
  if (has('purpose')) {
    if (!MEDIA_PURPOSES.includes(body.purpose)) errors.push('วัตถุประสงค์ของสื่อไม่ถูกต้อง');
    else out.purpose = body.purpose;
  }
  if (body.channels !== undefined || !partial) {
    const list = [].concat(body.channels ?? []);
    if (!list.length) errors.push('กรุณาเลือกช่องทางอย่างน้อย 1 ช่องทาง');
    else if (list.some((c) => !MEDIA_CHANNELS.includes(c))) errors.push('ช่องทางไม่ถูกต้อง');
    else out.channels = MEDIA_CHANNELS.filter((c) => list.includes(c)); // ตัดตัวซ้ำ + เรียงตามลำดับมาตรฐาน
  }
  if (has('status')) {
    if (!MEDIA_STATUSES.includes(body.status)) errors.push('สถานะสื่อไม่ถูกต้อง');
    else out.status = body.status;
  }
  if (has('postDate')) {
    if (!isValidDate(body.postDate)) errors.push('รูปแบบวันที่กำหนด Post ไม่ถูกต้อง');
    else out.postDate = body.postDate;
  }
  return { errors, data: out };
}

// ---------- Budget helpers ----------

const round2 = (n) => Math.round(n * 100) / 100;

function isValidMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// สรุปงบของเดือน: รายจ่ายจริง = ผลรวม budget ของกิจกรรมที่ startDate อยู่ในเดือนนั้น
function monthSummary(month, budgets, tasks) {
  const setting = budgets.find((b) => b.month === month);
  const monthTasks = tasks.filter((t) => t.startDate.slice(0, 7) === month);
  const spent = round2(monthTasks.reduce((s, t) => s + (t.budget || 0), 0));
  const budget = setting ? setting.amount : null;
  return {
    month,
    budget,
    spent,
    remaining: budget === null ? null : round2(budget - spent),
    usedPct: budget ? Math.round((spent / budget) * 1000) / 10 : null,
    taskCount: monthTasks.length,
  };
}

function removeUploadedFiles(files = []) {
  for (const f of files) {
    const p = path.join(UPLOAD_DIR, path.basename(f.filename));
    fs.unlink(p, () => {});
  }
}

// ---------- Upload ----------

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const BLOCKED_EXT = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.js', '.html', '.htm', '.php'];

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.includes(ext)) return cb(new Error(`ไม่อนุญาตให้อัปโหลดไฟล์ประเภท ${ext}`));
    cb(null, true);
  },
});

function toAttachment(file) {
  // multer ส่งชื่อไฟล์มาเป็น latin1 ต้องแปลงกลับเป็น utf8 เพื่อให้ชื่อภาษาไทยถูกต้อง
  const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return {
    filename: file.filename,
    originalName,
    size: file.size,
    mimetype: file.mimetype,
    url: `/uploads/${file.filename}`,
    uploadedAt: new Date().toISOString(),
  };
}

// ---------- App ----------

const app = express();
app.set('trust proxy', 'loopback'); // อ่าน x-forwarded-* เมื่อรันหลัง reverse proxy บนเครื่องเดียวกัน
app.use(express.json());
// ---------- Authentication (Supabase Auth) ----------
// ตรวจ cookie → req.user / req.db, ลงทะเบียน /api/auth/*, กัน API และหน้าแอปจากผู้ที่ยังไม่ login
app.use(auth.authenticate);
auth.registerRoutes(app);
app.use('/api', auth.requireApiAuth);
app.use(auth.pageGuard);
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

// Express 4 ไม่จับ error จาก async handler เอง — ส่งต่อไปที่ error handler
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// รายการงานทั้งหมด (เรียงตามความเร่งด่วน) รองรับ ?from=YYYY-MM-DD&to=YYYY-MM-DD
app.get('/api/tasks', ah(async (req, res) => {
  const { from, to } = req.query;
  const [all, names] = await Promise.all([loadTasks(req.db), loadNames(req)]);
  res.json(sortTasks(filterByRange(all, from, to)).map((t) => withNames(names)(withComputed(t))));
}));

app.get('/api/tasks/:id', ah(async (req, res) => {
  const task = await req.db.tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'ไม่พบงานนี้' });
  res.json(withNames(await loadNames(req))(withComputed(task)));
}));

// สรุปภาพรวมสำหรับ Dashboard
app.get('/api/summary', ah(async (req, res) => {
  const { from, to } = req.query;
  const tasks = filterByRange(await loadTasks(req.db), from, to);
  const today = todayStr();
  const summary = { total: tasks.length, done: 0, nearDue: 0, overdue: 0, inProgress: 0, totalBudget: 0 };
  for (const t of tasks) {
    const s = dueState(t, today);
    if (s === 'done') summary.done++;
    else if (s === 'overdue') summary.overdue++;
    else if (s === 'near_due') summary.nearDue++;
    if (t.status === 'in_progress') summary.inProgress++;
    summary.totalBudget += t.budget || 0;
  }
  res.json(summary);
}));

app.post('/api/tasks', upload.array('files', MAX_FILES), ah(async (req, res) => {
  const { errors, data } = validateTask(req.body);
  if (!errors.length && data.startDate > data.endDate) errors.push('วันที่เริ่มต้องไม่หลังวันที่เสร็จ');
  if (errors.length) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: errors.join(', ') });
  }
  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    ...data,
    kpi: data.kpi || '',
    links: data.links || [],
    budgetItems: data.budgetItems || [],
    kpiResult: data.kpiResult || '',
    progress: data.progress || '',
    progressUpdatedAt: data.progress ? now : '',
    status: data.status || 'pending',
    attachments: (req.files || []).map(toAttachment),
    createdBy: userId(req),
    updatedBy: userId(req),
    createdAt: now,
    updatedAt: now,
  };
  const saved = await req.db.tasks.insert(task);
  res.status(201).json(withNames(await loadNames(req))(withComputed(saved)));
}));

// แก้ไขงาน / อัปเดตสถานะ / เพิ่มไฟล์แนบ / ลบไฟล์แนบ (removeAttachments = JSON array ของ filename)
app.put('/api/tasks/:id', upload.array('files', MAX_FILES), ah(async (req, res) => {
  const current = await req.db.tasks.get(req.params.id);
  if (!current) {
    removeUploadedFiles(req.files);
    return res.status(404).json({ error: 'ไม่พบงานนี้' });
  }
  const { errors, data } = validateTask(req.body, true);
  const merged = { ...current, ...data };
  if (!errors.length && merged.startDate > merged.endDate) errors.push('วันที่เริ่มต้องไม่หลังวันที่เสร็จ');
  if (errors.length) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: errors.join(', ') });
  }

  let toRemove = [];
  if (req.body.removeAttachments) {
    try {
      toRemove = [].concat(JSON.parse(req.body.removeAttachments));
    } catch {
      toRemove = [];
    }
  }
  const attachments = merged.attachments || [];
  const removed = attachments.filter((a) => toRemove.includes(a.filename));
  merged.attachments = attachments
    .filter((a) => !toRemove.includes(a.filename))
    .concat((req.files || []).map(toAttachment));
  merged.updatedAt = new Date().toISOString();
  merged.updatedBy = userId(req);
  if (data.progress !== undefined && data.progress !== (current.progress || '')) {
    merged.progressUpdatedAt = data.progress ? merged.updatedAt : '';
  }

  const saved = await req.db.tasks.update(current.id, merged);
  removeUploadedFiles(removed);
  res.json(withNames(await loadNames(req))(withComputed(saved || merged)));
}));

// อัปเดตเฉพาะสถานะ (ใช้กับปุ่มเปลี่ยนสถานะด่วน)
app.patch('/api/tasks/:id/status', ah(async (req, res) => {
  if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  const task = await req.db.tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'ไม่พบงานนี้' });
  const saved = await req.db.tasks.update(task.id, { ...task, status: req.body.status, updatedAt: new Date().toISOString(), updatedBy: userId(req) });
  res.json(withNames(await loadNames(req))(withComputed(saved)));
}));

app.delete('/api/tasks/:id', ah(async (req, res) => {
  const task = await req.db.tasks.get(req.params.id);
  if (!task || !(await req.db.tasks.remove(task.id))) return res.status(404).json({ error: 'ไม่พบงานนี้' });
  removeUploadedFiles(task.attachments);
  res.status(204).end();
}));

// ---------- Media Planner ----------

// รายการแผนสื่อ เรียงตามวันที่ Post รองรับ ?from=YYYY-MM-DD&to=YYYY-MM-DD (กรองตาม postDate)
app.get('/api/media', ah(async (req, res) => {
  const { from, to } = req.query;
  const [all, names] = await Promise.all([loadMedia(req.db), loadNames(req)]);
  const items = all.filter((m) => (!from || m.postDate >= from) && (!to || m.postDate <= to));
  res.json(sortMedia(items).map(withNames(names)));
}));

app.get('/api/media/:id', ah(async (req, res) => {
  const item = await req.db.media.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'ไม่พบแผนสื่อนี้' });
  res.json(withNames(await loadNames(req))(withMediaStatus(item)));
}));

app.post('/api/media', ah(async (req, res) => {
  const { errors, data } = validateMedia(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });
  const now = new Date().toISOString();
  const item = { id: crypto.randomUUID(), detail: '', audience: '', links: [], status: 'pending', ...data, createdBy: userId(req), updatedBy: userId(req), createdAt: now, updatedAt: now };
  res.status(201).json(withNames(await loadNames(req))(await req.db.media.insert(item)));
}));

app.put('/api/media/:id', ah(async (req, res) => {
  const current = await req.db.media.get(req.params.id);
  if (!current) return res.status(404).json({ error: 'ไม่พบแผนสื่อนี้' });
  const { errors, data } = validateMedia(req.body || {}, true);
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });
  const merged = { ...withMediaStatus(current), ...data, updatedAt: new Date().toISOString(), updatedBy: userId(req) };
  res.json(withNames(await loadNames(req))((await req.db.media.update(current.id, merged)) || merged));
}));

app.delete('/api/media/:id', ah(async (req, res) => {
  if (!(await req.db.media.remove(req.params.id))) return res.status(404).json({ error: 'ไม่พบแผนสื่อนี้' });
  res.status(204).end();
}));

// ---------- Budget Planning ----------

// สรุปงบรายเดือนหลายเดือนต่อกัน ?from=YYYY-MM (ค่าเริ่มต้น = เดือนปัจจุบัน) &months=12 (สูงสุด 36)
app.get('/api/budgets', ah(async (req, res) => {
  const from = req.query.from || todayStr().slice(0, 7);
  if (!isValidMonth(from)) return res.status(400).json({ error: 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)' });
  const months = Math.min(36, Math.max(1, parseInt(req.query.months, 10) || 12));
  const [budgets, tasks] = await Promise.all([loadBudgets(req.db), loadTasks(req.db)]);
  res.json(Array.from({ length: months }, (_, i) => monthSummary(addMonths(from, i), budgets, tasks)));
}));

// สรุปงบเดือนเดียว พร้อมรายการกิจกรรมที่ใช้งบในเดือนนั้น
app.get('/api/budgets/:month', ah(async (req, res) => {
  const { month } = req.params;
  if (!isValidMonth(month)) return res.status(400).json({ error: 'รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)' });
  const [budgets, tasks] = await Promise.all([loadBudgets(req.db), loadTasks(req.db)]);
  const monthTasks = tasks
    .filter((t) => t.startDate.slice(0, 7) === month)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (b.budget || 0) - (a.budget || 0));
  const names = await loadNames(req);
  res.json({ ...monthSummary(month, budgets, tasks), tasks: monthTasks.map((t) => withNames(names)(withComputed(t))) });
}));

// บันทึกงบหลายเดือนพร้อมกัน: { budgets: [{ month: 'YYYY-MM', amount: number | null }] } — amount ว่าง/null = ลบการตั้งค่าเดือนนั้น
app.put('/api/budgets', ah(async (req, res) => {
  const input = req.body && req.body.budgets;
  if (!Array.isArray(input) || !input.length) return res.status(400).json({ error: 'ไม่มีข้อมูลงบประมาณที่จะบันทึก' });
  if (input.length > 36) return res.status(400).json({ error: 'บันทึกได้สูงสุดครั้งละ 36 เดือน' });

  const errors = [];
  for (const b of input) {
    if (!b || !isValidMonth(b.month)) { errors.push('รูปแบบเดือนไม่ถูกต้อง (YYYY-MM)'); continue; }
    if (b.amount === null || b.amount === undefined || b.amount === '') continue;
    const n = Number(b.amount);
    if (!Number.isFinite(n) || n < 0) errors.push(`งบประมาณเดือน ${b.month} ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`);
  }
  if (errors.length) return res.status(400).json({ error: [...new Set(errors)].join(', ') });

  const now = new Date().toISOString();
  // เดือนเดียวกันส่งมาซ้ำ ใช้ค่าสุดท้าย
  const entries = [...new Map(input.map((b) => {
    const empty = b.amount === null || b.amount === undefined || b.amount === '';
    return [b.month, { month: b.month, amount: empty ? null : round2(Number(b.amount)), updatedAt: now, updatedBy: userId(req) }];
  })).values()];
  await req.db.budgets.apply(entries);

  const [budgets, tasks] = await Promise.all([loadBudgets(req.db), loadTasks(req.db)]);
  res.json(input.map((b) => monthSummary(b.month, budgets, tasks)));
}));

// จัดการ error จาก multer / อื่น ๆ
app.use((err, req, res, next) => {
  removeUploadedFiles(req.files);
  if (err instanceof multer.MulterError) {
    const msg = {
      LIMIT_FILE_SIZE: `ไฟล์ใหญ่เกิน ${MAX_FILE_SIZE / 1024 / 1024} MB`,
      LIMIT_FILE_COUNT: `แนบไฟล์ได้สูงสุด ${MAX_FILES} ไฟล์`,
    }[err.code] || err.message;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(err.status || 400).json({ error: err.message || 'เกิดข้อผิดพลาด' });
});

app.listen(PORT, () => {
  console.log(`Marketing Task Management System กำลังทำงานที่ http://localhost:${PORT}`);
  console.log(`ที่เก็บข้อมูลกิจกรรม/แผนสื่อ: ${db.backend}`);
  console.log(auth.enabled ? 'ระบบ Login: เปิด (Supabase Auth)' : '⚠ ระบบ Login: ปิด — ยังไม่ได้ตั้งค่า Supabase ทุกคนเข้าใช้งานได้');
});
