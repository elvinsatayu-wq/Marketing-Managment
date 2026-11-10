// สร้างข้อมูลตัวอย่างใน data/tasks.json (วันที่อิงจากวันนี้) — จะเขียนทับข้อมูลเดิม
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'tasks.json');

function offset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const samples = [
  ['online', 'แคมเปญโฆษณา Facebook Ads ไตรมาส 4', 'เพิ่มยอดผู้ติดตามและ Lead ใหม่ 30%', -20, 10, 85000, 'urgent', 'สมชาย ใจดี', 'in_progress'],
  ['offline', 'บูธงาน Thailand Marketing Expo', 'สร้างการรับรู้แบรนด์และเก็บรายชื่อลูกค้า', 3, 6, 150000, 'urgent', 'วิภา ศรีสุข', 'pending'],
  ['online', 'ผลิตคอนเทนต์ TikTok ซีรีส์สินค้าใหม่', 'เพิ่ม Engagement กลุ่มอายุ 18-30 ปี', -10, -2, 40000, 'urgent', 'ณัฐพล แก้วมณี', 'in_progress'],
  ['online', 'ปรับปรุง SEO เว็บไซต์', 'ดัน Keyword หลักขึ้นหน้าแรก Google', -30, 25, 30000, 'normal', 'ปวีณา ทองดี', 'in_progress'],
  ['offline', 'พิมพ์โบรชัวร์และป้ายหน้าร้าน', 'รองรับโปรโมชั่นปลายปี', -25, -12, 18000, 'normal', 'วิภา ศรีสุข', 'done'],
  ['online', 'Email Marketing โปรโมชั่น 11.11', 'กระตุ้นยอดขายช่วงเทศกาล', 1, 16, 12000, 'normal', 'สมชาย ใจดี', 'pending'],
  ['offline', 'กิจกรรม Roadshow ห้างสรรพสินค้า', 'ทดลองสินค้าและขายตรงหน้างาน', 20, 34, 120000, 'normal', 'ณัฐพล แก้วมณี', 'pending'],
  ['online', 'จ้าง Influencer รีวิวสินค้า', 'สร้างความน่าเชื่อถือและรีวิวเชิงบวก', -6, 4, 60000, 'urgent', 'ปวีณา ทองดี', 'pending'],
];

const now = new Date().toISOString();
const COMPANIES = ['biowood', 'woodmate', 'econic'];
const tasks = samples.map(([type, name, objective, s, e, budget, urgency, owner, status], i) => ({
  id: crypto.randomUUID(),
  company: COMPANIES[i % COMPANIES.length],
  type, name, objective,
  startDate: offset(s),
  endDate: offset(e),
  budget, urgency, owner, status,
  attachments: [],
  createdAt: now,
  updatedAt: now,
}));

// --media-only: สร้างเฉพาะแผนสื่อ ไม่แตะ tasks.json
const mediaOnly = process.argv.includes('--media-only');

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!mediaOnly) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf8');
  console.log(`สร้างข้อมูลตัวอย่าง ${tasks.length} รายการที่ ${DATA_FILE}`);
}

// ---------- Media Planner ----------
// [ชื่องาน, รายละเอียด, ประเภทสื่อ, ช่องทาง, วัตถุประสงค์, วันที่ Post (offset จากวันนี้)]
const mediaSamples = [
  ['โปสเตอร์โปรโมชั่น 11.11 ลด 50%', 'ภาพโปรโมชั่นหลัก ใช้ร่วมกับแคมเปญ Email', 'image', ['facebook', 'instagram'], 'sale', 0],
  ['คลิปรีวิวสินค้าใหม่ 60 วินาที', 'ถ่ายทำร่วมกับ Influencer เน้นจุดเด่น 3 ข้อ', 'video', ['tiktok', 'instagram'], 'value', 2],
  ['ประกาศเปิดสาขาใหม่', 'แจ้งวันเปิดและโปรโมชั่นเปิดสาขา', 'image', ['facebook', 'website'], 'news', 4],
  ['ป้ายบิลบอร์ดหน้าห้างฯ', 'ป้ายโปรโมชั่นปลายปี ขนาด 6x12 ม.', 'offline', ['billboard'], 'sale', 6],
  ['Infographic 5 วิธีเลือกสินค้าให้เหมาะกับคุณ', 'คอนเทนต์ให้ความรู้ แบบ Carousel 6 ภาพ', 'image', ['facebook', 'instagram'], 'value', 7],
  ['Behind the scenes งาน Expo', 'คลิปสั้นบรรยากาศบูธ', 'video', ['tiktok', 'facebook'], 'news', 9],
  ['Flash Sale 12.12 Countdown', 'ภาพนับถอยหลัง 3 วันก่อนเริ่มโปร', 'image', ['facebook', 'instagram', 'tiktok'], 'sale', 13],
  ['บทความ SEO: เทรนด์การตลาดปีหน้า', 'บทความยาว 1,500 คำ บนบล็อกเว็บไซต์', 'image', ['website'], 'value', 16],
  ['วิดีโอสรุปผลงานประจำปี', 'Year in review ความยาว 2 นาที', 'video', ['facebook', 'website'], 'news', 24],
  ['ใบปลิวแจกหน้าร้าน', 'ใบปลิว A5 สำหรับกิจกรรม Roadshow', 'offline', ['billboard'], 'sale', 21],
  ['คลิป How-to การใช้งานสินค้า', 'สอนการใช้งานแบบ step-by-step', 'video', ['tiktok', 'instagram', 'website'], 'value', -3],
  ['แจ้งวันหยุดทำการ', 'ภาพประกาศวันหยุดประจำเดือน', 'image', ['facebook'], 'news', -6],
];

const MEDIA_FILE = path.join(__dirname, '..', 'data', 'media.json');
const media = mediaSamples.map(([name, detail, mediaType, channels, purpose, d], i) => ({
  id: crypto.randomUUID(),
  company: COMPANIES[i % COMPANIES.length],
  name, detail, mediaType, channels, purpose,
  status: d < 0 ? 'posted' : d <= 1 ? 'scheduled' : d <= 4 ? 'producing' : 'pending',
  postDate: offset(d),
  createdAt: now,
  updatedAt: now,
}));
fs.writeFileSync(MEDIA_FILE, JSON.stringify(media, null, 2), 'utf8');
console.log(`สร้างแผนสื่อตัวอย่าง ${media.length} รายการที่ ${MEDIA_FILE}`);
