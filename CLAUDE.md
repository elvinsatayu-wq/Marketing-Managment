# Marketing Task Management System (ระบบจัดการงานการตลาด)

เว็บแอปจัดการกิจกรรมการตลาด: Dashboard สรุปภาพรวม + Timeline (Gantt) + การ์ดงบคงเหลือเดือนนี้ + ปฏิทินแผนสื่อ, หน้าจัดการกิจกรรมพร้อม Link งาน (เมนูแนบไฟล์ถูกนำออกจาก UI แล้ว แต่ API ยังรองรับ `files`), หน้า Media Planner และหน้าวางแผนงบประมาณรายเดือน

## คำสั่ง

```bash
npm install      # ติดตั้ง dependency
npm start        # รันเซิร์ฟเวอร์ที่ http://localhost:3000 (เปลี่ยนพอร์ตด้วย PORT=xxxx)
npm run dev      # รันแบบ auto-restart (node --watch)
npm run seed     # สร้างงานตัวอย่าง 8 รายการ + แผนสื่อ 12 รายการ (เขียนทับ data/tasks.json และ data/media.json!)
npm run seed -- --media-only   # สร้างเฉพาะแผนสื่อตัวอย่าง (เขียนทับ data/media.json อย่างเดียว)
npm run db:migrate   # ย้ายข้อมูลจาก data/tasks.json + media.json + budgets.json ขึ้น Supabase (upsert ตาม id, รันซ้ำได้) — ต้องมี SUPABASE_SECRET_KEY หรือ MIGRATE_EMAIL/MIGRATE_PASSWORD
npm run seed:users   # สร้างบัญชี marketing1-4@domain.com ใน Supabase Auth + profiles (ต้องมี SUPABASE_SECRET_KEY; --reset-password = ตั้งรหัสผ่านกลับเป็นค่าเริ่มต้น)
```

ต้องใช้ Node.js 20.12 ขึ้นไป (ใช้ `process.loadEnvFile()` อ่าน `.env.local`)

## ที่เก็บข้อมูล (Supabase / JSON)

- `db.js` เลือกที่เก็บกิจกรรม (`tasks`), แผนสื่อ (`media`) และงบที่ตั้งไว้รายเดือน (`budgets`, key = `month`, เขียนผ่าน `db.budgets.apply()` — `amount: null` = ลบ): ถ้า `.env.local` มี `NEXT_PUBLIC_SUPABASE_URL` + key → **Supabase**, ไม่มี → ไฟล์ `data/*.json` (fallback)
- key: ใช้ `SUPABASE_SECRET_KEY` ถ้ามี ไม่งั้นใช้ `NEXT_PUBLIC_SUPABASE_ANON_KEY` — อ่านเฉพาะฝั่ง server ไม่ส่งไป browser (ไม่ใช่ Next.js แม้ชื่อตัวแปรจะขึ้นต้น `NEXT_PUBLIC_`)
- สร้างตารางด้วย `supabase/schema.sql` (รันใน Supabase SQL Editor) — คอลัมน์เป็น snake_case, `db.js` แปลงเป็น camelCase (`taskToRow`/`rowToTask`, `mediaToRow`/`rowToMedia`) — เพิ่มฟิลด์ใหม่ต้องแก้ schema.sql + ตัวแปลงทั้งสองทาง
- RLS (schema.sql) อนุญาตเฉพาะ role `authenticated` — ทุก request ของ API ใช้ `req.db` (= `db.forToken(accessToken)`, client ที่แนบ access token ของผู้ใช้) ห้ามใช้ `db.tasks`/`db.media`/`db.budgets` ตรง ๆ ใน route (นั่นคือ client ไม่มีผู้ใช้ ใช้กับสคริปต์เท่านั้น)
- policy insert/update บังคับ `created_by`/`updated_by` = `auth.uid()` → route ต้องตั้ง `createdBy`/`updatedBy` = `userId(req)` ทุกครั้งที่เขียน (secret key ข้าม RLS)
- route ทั้งหมดเป็น async ห่อด้วย `ah()`; error ฐานข้อมูลตอบ 500 พร้อมข้อความไทย
- **ยังเก็บในไฟล์:** ไฟล์แนบ (`public/uploads/`); `npm run seed` ยังเขียนลงไฟล์ JSON เท่านั้น

## โครงสร้าง

```
server.js            Express API + multer upload
auth.js              Supabase Auth: /api/auth/login|logout|me, middleware authenticate / requireApiAuth / pageGuard
db.js                ชั้นจัดเก็บ tasks/media/budgets/profiles (Supabase หรือ JSON) + โหลด .env.local
supabase/schema.sql  สร้างตาราง tasks/media/budgets/profiles + trigger สร้าง profile + RLS policy
scripts/seed-users.js  สร้าง 4 บัญชีเริ่มต้น (Marketing 1-4)
.env.local           ค่าเชื่อมต่อ Supabase (ไม่ commit, ดูตัวอย่างใน .env.example)
scripts/seed.js      สร้างข้อมูลตัวอย่าง (วันที่อิงจากวันที่รัน)
data/tasks.json      ฐานข้อมูลกิจกรรม (JSON array) สร้างอัตโนมัติ ไม่ต้อง commit
data/media.json      ฐานข้อมูลแผนสื่อ (JSON array) สร้างอัตโนมัติ ไม่ต้อง commit
data/budgets.json    งบประมาณที่ตั้งไว้รายเดือน (โหมด fallback เมื่อไม่ได้ตั้งค่า Supabase)
public/index.html    Frontend ทั้งหมด (HTML + CSS + vanilla JS ในไฟล์เดียว, ไม่มี build step)
public/login.html    หน้าเข้าสู่ระบบ (เสิร์ฟที่ /login)
public/logo.png     โลโก้ GRM ใน sidebar (สำเนาจาก 01-5-768x914.png)
public/uploads/      ไฟล์แนบที่อัปโหลด (ตั้งชื่อใหม่เป็น <timestamp>-<random><ext>)
```

- Chart.js เสิร์ฟจาก `node_modules/chart.js/dist` ผ่าน route `/vendor/chart.js/` (ใช้งาน offline ได้ ไม่พึ่ง CDN)
- ฟอนต์ IBM Plex Sans Thai โหลดจาก Google Fonts (ถ้า offline จะ fallback เป็นฟอนต์ระบบ)

## Data model (Task)

| field | ค่า |
|---|---|
| `id` | UUID |
| `company` | `biowood` (Biowood) \| `woodmate` (Wood mate) \| `econic` (Econic) — บังคับตอนสร้าง; ข้อมูลเก่า = `''` (ไม่แสดง badge, บังคับเลือกเมื่อแก้ไขผ่านฟอร์ม) — ค่าใน `COMPANIES` (server.js) / `COMPANY_LABEL` (index.html), class สี `co-*` |
| `type` | `online` \| `offline` |
| `name`, `objective` | string |
| `owners` | `string[]` ผู้รับผิดชอบ (อย่างน้อย 1, สูงสุด `MAX_OWNERS` = 20) — ส่งเป็น JSON string, validate ใน `parseOwners()` (ตัดตัวซ้ำ) |
| `owner` | string = `owners.join(', ')` — server ตั้งให้อัตโนมัติ เก็บไว้เพื่อให้การแสดงผล/ค้นหาเดิมทำงานได้; งานเก่าที่ไม่มี `owners` ฝั่ง client ใช้ `taskOwners(t)` |
| `startDate`, `endDate` | `YYYY-MM-DD` (start ≤ end) |
| `budget` | number (บาท, ≥ 0) |
| `budgetItems` | `[{ detail, amount }]` รายการใช้งบประมาณโดยประมาณ (ไม่บังคับ, สูงสุด `MAX_BUDGET_ITEMS` = 50) — ส่งเป็น JSON string, validate ใน `parseBudgetItems()`; **ไม่ผูกกับ `budget`** (ฟอร์มแสดงยอดรวมและปุ่ม "ใช้ยอดรวมเป็นงบประมาณ" เมื่อไม่ตรงกัน) — การคำนวณงบรายเดือนยังใช้ `budget` |
| `urgency` | `urgent` (ด่วนมาก) \| `normal` (ปกติ) |
| `kpi` | string (ไม่บังคับ, หลายบรรทัดได้ — 1 บรรทัดต่อ 1 ตัวชี้วัด) |
| `status` | `pending` \| `in_progress` \| `done` |
| `progress` | string อัปเดตความคืบหน้าของงาน (ไม่บังคับ, หลายบรรทัดได้, สูงสุด 2000 ตัวอักษร) — กรอกได้ทั้งตอนสร้างและแก้ไข (ช่องอยู่ใต้ช่องสถานะงาน) แสดงในการ์ดกิจกรรม |
| `progressUpdatedAt` | ISO timestamp ที่ server ตั้งให้ตอน POST (ถ้ามี `progress`) หรือเมื่อ `progress` เปลี่ยนใน PUT (`''` เมื่อล้างข้อความ) |
| `kpiResult` | `''` (ยังไม่สรุป) \| `pass` (ผ่าน KPI) \| `fail` (ไม่ผ่าน KPI) — ค่าใน `KPI_RESULTS` (server.js) / `LABEL.kpiResult` (index.html); เปลี่ยนได้จาก dropdown ในการ์ดกิจกรรม (PUT JSON) หรือในฟอร์ม |
| `links` | `[{ label, url }]` Link งาน (ไม่บังคับ, สูงสุด `MAX_LINKS` = 20) — ส่งเป็น JSON string ใน field `links`; รับเฉพาะ http/https, ไม่ใส่ scheme จะเติม `https://` ให้ (`parseLinks()`); งานเก่าที่ไม่มีฟิลด์นี้ฝั่ง client ใช้ `t.links \|\| []` |
| `attachments` | `[{ filename, originalName, size, mimetype, url, uploadedAt }]` |
| `createdAt`, `updatedAt` | ISO timestamp |

`dueState` คำนวณตอนตอบ API (ไม่เก็บลงไฟล์): `done` / `overdue` (เลย endDate และยังไม่เสร็จ) / `near_due` (เหลือ ≤ 7 วัน — ค่าคงที่ `NEAR_DUE_DAYS`) / `on_track`

## API

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/tasks?from=&to=` | เรียง: ด่วนมากก่อน → ยังไม่เสร็จก่อนเสร็จ → endDate ใกล้สุดก่อน; `from/to` กรองงานที่ช่วงเวลาทับซ้อน |
| GET | `/api/tasks/:id` | |
| GET | `/api/summary?from=&to=` | `{ total, done, nearDue, overdue, inProgress, totalBudget }` |
| POST | `/api/tasks` | `multipart/form-data`, ไฟล์ใน field `files` (สูงสุด 10 ไฟล์ × 20 MB) |
| PUT | `/api/tasks/:id` | แก้ไขบางฟิลด์ได้ + เพิ่มไฟล์ (`files`) + ลบไฟล์ (`removeAttachments` = JSON array ของ filename) |
| PATCH | `/api/tasks/:id/status` | JSON `{ status }` — ใช้กับ dropdown เปลี่ยนสถานะในรายการ |
| DELETE | `/api/tasks/:id` | ลบไฟล์แนบใน `public/uploads` ด้วย |

ข้อความ error ทั้งหมดเป็นภาษาไทยในรูป `{ error: "..." }`

## Media Planner

### Data model (Media)

| field | ค่า |
|---|---|
| `id` | UUID |
| `company` | เหมือน `company` ของ Task — แสดงในการ์ด, modal รายละเอียด, ปฏิทิน และแยกสีปฏิทินตามบริษัทได้ |
| `name` | string (บังคับ) |
| `detail` | string (ไม่บังคับ, หลายบรรทัดได้) |
| `audience` | string กลุ่มเป้าหมายที่ต้องการสื่อสาร (ไม่บังคับ, หลายบรรทัดได้, สูงสุด 1000 ตัวอักษร) — แสดงในการ์ด Media Planner, modal รายละเอียด และค้นหาได้ |
| `mediaType` | `image` (ภาพนิ่ง) \| `video` (วิดีโอ) \| `offline` (สื่อออฟไลน์) |
| `channels` | array อย่างน้อย 1 ค่าจาก `facebook` \| `instagram` (IG) \| `tiktok` \| `website` (เว็บไซต์) \| `billboard` (ป้ายโฆษณา) — server ตัดตัวซ้ำและเรียงตามลำดับนี้ |
| `purpose` | `sale` (Sale Content) \| `value` (Value Content) \| `news` (News Content) |
| `status` | `pending` (In plan) \| `producing` (In Production) \| `scheduled` (Scheduled) \| `posted` (Published) — ค่าเริ่มต้น `pending`; แผนสื่อเก่าที่ไม่มีฟิลด์นี้ `loadMedia()` เติมให้ตอนอ่าน (เลย `postDate` = `posted`, ยังไม่ถึง = `pending`) |
| `postDate` | `YYYY-MM-DD` วันที่กำหนด Post |
| `links` | `[{ label, url }]` Link งาน (ไม่บังคับ) — ส่งเป็น array ใน JSON body, validate ด้วย `parseLinks()` เดียวกับ Task |
| `createdAt`, `updatedAt` | ISO timestamp |

ค่าที่อนุญาตอยู่ใน `MEDIA_TYPES` / `MEDIA_CHANNELS` / `MEDIA_PURPOSES` / `MEDIA_STATUSES` (server.js) และป้ายภาษาไทยอยู่ใน `MEDIA_LABEL` (index.html) — ถ้าเพิ่มค่าใหม่ต้องแก้ทั้งสองที่ + เพิ่ม class สี (`mt-*`, `pp-*`, `ms-*`, `ch-*`) ใน CSS

### API (JSON body, ไม่มีไฟล์แนบ)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/media?from=&to=` | เรียงตาม `postDate` แล้วตามชื่อ; `from/to` กรองตาม `postDate` |
| GET | `/api/media/:id` | |
| POST | `/api/media` | ต้องมี `name, mediaType, purpose, channels, postDate` |
| PUT | `/api/media/:id` | แก้ไขบางฟิลด์ได้ (partial) |
| DELETE | `/api/media/:id` | |

### Frontend

- เมนู **Media Planner** (`#page-media`): รายการจัดกลุ่มตามเดือน, กรองตามคำค้น/ประเภทสื่อ/วัตถุประสงค์/ช่องทาง/สถานะสื่อ และ ทั้งหมด/กำลังจะมาถึง/โพสต์ไปแล้ว; การ์ดที่ผ่านวันโพสต์แล้วจะจางลง, ภายใน 7 วันมี badge "วันนี้/พรุ่งนี้/อีก N วัน"; การ์ดมี dropdown เปลี่ยนสถานะสื่อ (PUT `{ status }`)
- **ปฏิทินแผนสื่อ** ในหน้า Dashboard (`#cal`, state อยู่ในอ็อบเจกต์ `cal`): สลับรายเดือน/รายสัปดาห์ (สัปดาห์เริ่มวันอาทิตย์), เลื่อน ‹ วันนี้ ›, เลือกแยกสีตาม ประเภทสื่อ / วัตถุประสงค์ / สถานะ (legend แสดงจำนวน) — ปฏิทินมีการนำทางของตัวเอง ไม่ขึ้นกับตัวกรองช่วงวันที่ของ Dashboard
  - การ์ดจำนวนสื่อตามสถานะ (`#cal-status`) เหนือปฏิทิน: นับเฉพาะเดือน/สัปดาห์ที่แสดง, In plan/In Production ที่เลยวันโพสต์แล้วแสดง "เลยวันโพสต์ N รายการ"; คลิกการ์ด → ไปหน้า Media Planner กรองตามสถานะนั้น
  - คลิกรายการ → modal รายละเอียด (`#media-view`) มีปุ่มแก้ไข/ลบ; คลิกช่องว่างของวันในมุมมองรายเดือน → ไปมุมมองรายสัปดาห์ของวันนั้น; ปุ่ม `+` ในช่องวัน → เพิ่มแผนสื่อโดยกรอกวันที่ให้
  - รายเดือนแสดงสูงสุด 3 รายการต่อวัน ที่เหลือเป็น "+N เพิ่มเติม"; บนมือถือ (≤760px) รายเดือนแสดงเป็นจุดสี และรายสัปดาห์เรียงเป็นแนวตั้ง
- สีใช้ CSS custom property: class `mt-<mediaType>` / `pp-<purpose>` / `ms-<status>` (prefix ใน `TONE_PREFIX`) กำหนด `--c` (สีหลัก) และ `--s` (พื้นอ่อน) ใช้ร่วมกันใน badge (`.tone`), ปฏิทิน, ปุ่มตัวเลือกในฟอร์ม; `ch-<channel>` กำหนด `--dot`
- ปุ่มปิด/คลิกพื้นหลัง/Esc ทำงานกับทุก `.modal-backdrop` (Esc ปิด modal บนสุด)

## Budget Planning (วางแผนงบประมาณรายเดือน)

### Data model

`data/budgets.json` เก็บเฉพาะงบที่ "ตั้งไว้": `[{ month: "YYYY-MM", amount: number (บาท, ≥ 0), updatedAt }]` — เดือนที่ไม่มีรายการ = ยังไม่ตั้งงบ

**งบที่ใช้จริง (spent) ไม่ได้เก็บ** — คำนวณสดทุกครั้งที่เรียก API = ผลรวม `budget` ของกิจกรรมที่ `startDate` อยู่ในเดือนนั้น (นับทุกสถานะ รวมงานที่ยังไม่เสร็จ; ทั้งก้อนลงเดือนที่เริ่ม ไม่เฉลี่ยตามจำนวนวัน) — logic อยู่ใน `monthSummary()` ใน server.js

รูปแบบสรุปรายเดือน: `{ month, budget (null = ยังไม่ตั้ง), spent, remaining (null ถ้ายังไม่ตั้ง, ติดลบ = เกินงบ), usedPct (null ถ้ายังไม่ตั้งหรืองบ = 0), taskCount }`

### API

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/budgets?from=YYYY-MM&months=12` | สรุปหลายเดือนต่อกัน (ค่าเริ่มต้น from = เดือนปัจจุบัน, months สูงสุด 36) |
| GET | `/api/budgets/:month` | สรุปเดือนเดียว + `tasks` (กิจกรรมเต็มรูปแบบพร้อม `dueState` ที่เริ่มในเดือนนั้น) |
| PUT | `/api/budgets` | JSON `{ budgets: [{ month, amount }] }` บันทึกหลายเดือนพร้อมกัน; `amount` เป็น `null`/`""` = ลบการตั้งงบเดือนนั้น |

### Frontend

- เมนู **วางแผนงบประมาณ** (`#page-budget`)
  - dropdown เลือกเดือน (`#b-month`, ย้อนหลัง/ล่วงหน้า 12 เดือน) → การ์ด 3 ใบ (งบที่ตั้งไว้ / งบที่ใช้ไปแล้ว / งบคงเหลือ — เปลี่ยนเป็นสีแดงเมื่อเกินงบ), progress bar การใช้งบ, กราฟแท่ง Chart.js (งบรวม vs ใช้จริง vs คงเหลือ) และตารางกิจกรรมที่ใช้งบเดือนนั้น (คลิกแถวเพื่อเปิด modal แก้ไขกิจกรรม)
  - ตาราง **ตั้งงบล่วงหน้า 12 เดือน** (`#bp-table`) เลือกเดือนเริ่มต้นได้ (`#bp-start`), มีกราฟเปรียบเทียบ 12 เดือน, ปุ่ม "ใช้ยอดนี้กับทุกเดือน", บันทึกทั้ง 12 เดือนในครั้งเดียว (ช่องว่าง = ไม่ตั้งงบ)
- **แจ้งเตือนรายการครบกำหนดวันนี้** (`#due-alert` บนสุดของ Dashboard + badge `#due-badge` บนเมนูแดชบอร์ด): กิจกรรมที่ `endDate` = วันนี้ และ `status !== 'done'` + แผนสื่อที่ `postDate` = วันนี้ และ status อยู่ใน `MEDIA_ALERT_STATUSES` (`pending`/`producing` — เปลี่ยนเป็น Scheduled/Published แล้วหาย) — `loadDueAlert()` ไม่ขึ้นกับตัวกรองช่วงวันที่, เรียกจาก `loadDashboard()` และ `reloadCurrentPage()`; กล่องแสดงตลอด: ไม่มีรายการ = `.is-empty`, กด "รับทราบ" = `.is-ack` ถึงสิ้นวัน (จำ `วันนี้|t:id,m:id` ใน `localStorage('dueAlertDismissed')`, มีรายการใหม่ → เตือนอีก); คลิกกิจกรรม → modal แก้ไข, คลิกแผนสื่อ → `openMediaView()`
- **การ์ดงบคงเหลือเดือนปัจจุบัน** ใน Dashboard (`#dash-budget`) อยู่ใต้ "งานที่ต้องติดตาม" ในคอลัมน์ขวา (`.side-col`) — แสดงยอดคงเหลือ, progress bar % ที่ใช้/คงเหลือ, งบที่ตั้งและยอดใช้; ไม่ขึ้นกับตัวกรองช่วงวันที่ของ Dashboard; คลิกเพื่อไปหน้าวางแผนงบประมาณ
- สี progress bar (`usageState()`): ปกติ = เขียว, ≥ 80% = เหลือง (`warn`), > 100% = แดง (`over`)
- การรีโหลดหลังบันทึกกิจกรรมใช้ `reloadCurrentPage()` (อิง `PAGE_LOADERS`) — เพิ่มหน้าใหม่ต้องลงทะเบียน loader ในอ็อบเจกต์นี้

## หมายเหตุสำหรับการพัฒนา

- ชื่อไฟล์ภาษาไทย: multer ส่ง `originalname` มาเป็น latin1 → แปลงเป็น utf8 ใน `toAttachment()`
- ไฟล์ประเภทสคริปต์/HTML (`BLOCKED_EXT`) ถูกปฏิเสธ เพราะ `public/uploads` เสิร์ฟเป็น static
- การเขียน `data/*.json` (โหมด fallback) ใช้ write-tmp-then-rename; ไม่มี locking
- **ระบบ Login (Supabase Auth, `auth.js`)** — เปิดอัตโนมัติเมื่อตั้งค่า Supabase; โหมดไฟล์ JSON ไม่มี login (ทุกคนเข้าได้)
  - `POST /api/auth/login` `{ identifier, password }` — identifier เป็นอีเมลหรือ username (แปลงด้วย RPC `login_email()`); สำเร็จ → cookie httpOnly `mms_access` + `mms_refresh`; ผิดเกิน 10 ครั้ง/15 นาที (ต่อ IP+บัญชี) ตอบ 429
  - `authenticate` ตรวจ token ด้วย `auth.getUser()` (cache 5 นาที), refresh อัตโนมัติเมื่อเหลือ < 60 วินาที (รวม request ที่ refresh พร้อมกันเป็นครั้งเดียว เพราะ refresh token ใช้ได้ครั้งเดียว) → `req.user = { id, email, username, displayName, role }`, `req.db`
  - `requireApiAuth`: `/api/*` ที่ยังไม่ login → 401 `{ error, code: 'UNAUTHENTICATED' }` (ฝั่ง client `api()` เจอ 401 → ไป `/login`); `pageGuard`: `/` → redirect `/login`, `/uploads/*` → 401, `/login` เมื่อ login แล้ว → `/`
  - Top bar (`#topbar` บนสุดของ `<main>`) แสดงชื่อ/อีเมล/role จาก `GET /api/auth/me` (`loadCurrentUser()`) + ปุ่มออกจากระบบ (`POST /api/auth/logout` ลบ cookie + เพิกถอน refresh token)
  - ตาราง `profiles` (id = auth.users.id, email, username, display_name, role `admin`|`marketing`) — trigger `on_auth_user_created` สร้างให้อัตโนมัติ; ทีมเห็นและแก้ไขข้อมูลของกันได้ทั้งหมด (ไม่จำกัดตามเจ้าของ)
  - **Data ownership:** `tasks`/`media` มี `created_by`, `updated_by`; `budgets` มี `updated_by` (uuid → profiles) — API ตอบ `createdBy`, `updatedBy`, `createdByName`, `updatedByName` (`withNames()` + cache ชื่อ 60 วินาที ใน server.js); การ์ดกิจกรรม/แผนสื่อแสดงด้วย `ownerLine()`; ข้อมูลเก่าก่อนมี login = null
- ช่องผู้รับผิดชอบเป็น tag input หลายคน (chip + datalist, Enter/เลือกจากรายการเพื่อเพิ่ม, state ใน `formOwners`); รายชื่อตั้งต้นอยู่ใน `DEFAULT_OWNERS` ใน index.html (ปัจจุบัน: Pine, Phat, Ant — สร้างงานใหม่เริ่มจากช่องว่าง ไม่กรอกชื่อให้อัตโนมัติ)
- Gantt ใช้ Chart.js bar chart แนวนอนแบบ floating (`data: [start, end]`) บนแกน `linear` (timestamp ms) — ไม่ต้องใช้ date adapter; มี plugin `todayLine` วาดเส้นวันนี้; คลิกแท่งเพื่อเปิด modal แก้ไข
  - เลื่อนแนวนอนได้ใน `#gantt-scroll` (ความกว้างรวมอย่างน้อย 600px); แกน y ของกราฟซ่อนอยู่ — ชื่อกิจกรรมเป็น HTML ในคอลัมน์ sticky `#gantt-labels` (กว้าง `--gantt-label-w`: 200px / 128px บนมือถือ) วางตำแหน่งให้ตรงแท่งด้วย plugin `ganttLabels` (`afterLayout` + `scales.y.getPixelForValue`) — คลิก/Enter ที่ชื่อเปิด modal แก้ไข
- วันที่ฝั่ง client parse เป็น local time ด้วย `parseISO()` (อย่าใช้ `new Date('YYYY-MM-DD')` เพราะจะเป็น UTC)
- UI เป็นภาษาไทยทั้งหมด, responsive ถึงจอมือถือ
- **Dark / Light mode**: ปุ่ม `#theme-toggle` ท้าย sidebar สลับ `data-theme` บน `<html>` และจำค่าใน `localStorage('theme')` (ยังไม่เลือก = ตามธีมระบบ); script ใน `<head>` ตั้งธีมก่อน render
  - สีทั้งหมดต้องใช้ CSS variable ใน `:root` และกำหนดค่าโหมดมืดใน `:root[data-theme="dark"]` — class สี `mt-*`/`pp-*`/`ms-*` มีชุด override `[data-theme="dark"] ...` แยก (เพิ่มค่าใหม่ต้องเพิ่มทั้งสองชุด)
  - สีกราฟ Chart.js อ่านจาก CSS variable ด้วย `cssVar()` ตอนสร้างกราฟ; เปลี่ยนธีมแล้ว `setTheme()` เรียก `reloadCurrentPage()` เพื่อ render กราฟใหม่
