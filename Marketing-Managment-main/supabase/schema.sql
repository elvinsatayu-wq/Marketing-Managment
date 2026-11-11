-- สร้างตารางสำหรับระบบจัดการงานการตลาด
-- วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์นี้ → Run (รันซ้ำได้ ไม่ลบข้อมูลเดิม)

-- ---------- กิจกรรมการตลาด ----------
create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null check (type in ('online', 'offline')),
  name                text not null,
  objective           text not null default '',
  owner               text not null default '',          -- = owners คั่นด้วย ", "
  owners              text[] not null default '{}',
  start_date          date not null,
  end_date            date not null,
  budget              numeric(14, 2) not null default 0 check (budget >= 0),
  budget_items        jsonb not null default '[]'::jsonb, -- [{ detail, amount }]
  urgency             text not null default 'normal' check (urgency in ('urgent', 'normal')),
  kpi                 text not null default '',
  kpi_result          text not null default '' check (kpi_result in ('', 'pass', 'fail')),
  status              text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  progress            text not null default '',
  progress_updated_at timestamptz,
  links               jsonb not null default '[]'::jsonb, -- [{ label, url }]
  attachments         jsonb not null default '[]'::jsonb, -- ไฟล์จริงยังอยู่ที่ public/uploads
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (start_date <= end_date)
);
create index if not exists tasks_start_date_idx on public.tasks (start_date);

-- ---------- แผนสื่อ (Media Planner) ----------
create table if not exists public.media (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  detail      text not null default '',
  audience    text not null default '',
  media_type  text not null check (media_type in ('image', 'video', 'offline')),
  channels    text[] not null default '{}',
  purpose     text not null check (purpose in ('sale', 'value', 'news')),
  status      text not null default 'pending' check (status in ('pending', 'producing', 'scheduled', 'posted')),
  post_date   date not null,
  links       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists media_post_date_idx on public.media (post_date);

-- ---------- งบประมาณที่ตั้งไว้รายเดือน ----------
-- เก็บเฉพาะเดือนที่ตั้งงบ (ไม่มีแถว = ยังไม่ตั้ง); งบที่ใช้จริงคำนวณสดจาก tasks
create table if not exists public.budgets (
  month       text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'), -- YYYY-MM
  amount      numeric(14, 2) not null check (amount >= 0),
  updated_at  timestamptz not null default now()
);

-- ---------- ผู้ใช้ (Supabase Auth) ----------
-- 1 แถวต่อ 1 บัญชีใน auth.users — สร้างอัตโนมัติด้วย trigger ด้านล่าง (ทั้งจาก npm run seed:users
-- และจาก Supabase Dashboard → Authentication → Add user)
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null unique,
  username      text not null unique,                    -- ใช้ login แทนอีเมลได้ เช่น marketing1
  display_name  text not null default '',
  role          text not null default 'marketing' check (role in ('admin', 'marketing')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, username, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'marketing')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ผู้ใช้ที่สร้างไว้ก่อนรันไฟล์นี้ (ก่อนมี trigger) → สร้าง profile ให้ (created_by อ้างอิง profiles)
insert into public.profiles (id, email, username, display_name)
select u.id, u.email,
       coalesce(nullif(u.raw_user_meta_data ->> 'username', ''), split_part(u.email, '@', 1)),
       coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''), split_part(u.email, '@', 1))
from auth.users u
where u.email is not null
on conflict do nothing;

-- แปลง username → email ตอน login (เรียกก่อนเข้าสู่ระบบจึงต้องให้ anon เรียกได้ — คืนเฉพาะอีเมลของ username ที่ระบุ)
-- drop ก่อนเพราะ create or replace เปลี่ยนชื่อพารามิเตอร์ไม่ได้ (ฐานข้อมูลเก่าอาจมี p_username) — auth.js เรียกด้วย p_identifier
drop function if exists public.login_email(text);
create or replace function public.login_email(p_identifier text)
returns text language sql stable security definer set search_path = public as $$
  select email from public.profiles where lower(username) = lower(trim(p_identifier)) limit 1;
$$;
revoke all on function public.login_email(text) from public;
grant execute on function public.login_email(text) to anon, authenticated;

-- ---------- ผู้สร้าง / ผู้แก้ไขล่าสุด (Data Ownership) ----------
-- server ส่ง id ของผู้ใช้ที่ login มาให้ทุกครั้ง (ค่าเริ่มต้น auth.uid() กันกรณีเขียนตรงจาก client อื่น)
-- ข้อมูลเก่าก่อนมีระบบ login = null
alter table public.tasks   add column if not exists created_by uuid default auth.uid() references public.profiles (id) on delete set null;
alter table public.tasks   add column if not exists updated_by uuid default auth.uid() references public.profiles (id) on delete set null;
alter table public.media   add column if not exists created_by uuid default auth.uid() references public.profiles (id) on delete set null;
alter table public.media   add column if not exists updated_by uuid default auth.uid() references public.profiles (id) on delete set null;
alter table public.budgets add column if not exists updated_by uuid default auth.uid() references public.profiles (id) on delete set null;
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists media_created_by_idx on public.media (created_by);

-- ---------- สิทธิ์การเข้าถึง (Row Level Security) ----------
-- server.js ส่ง access token ของผู้ใช้ที่ login ไปกับทุก query → Supabase มองเป็น role "authenticated"
-- ผู้ที่ไม่ได้ login (anon) อ่าน/เขียนข้อมูลไม่ได้แล้ว
-- ทีม Marketing ทุกคนเห็นและแก้ไขงานของกันได้ (ทำงานร่วมกัน) — บันทึกผู้สร้าง/ผู้แก้ไขใน created_by / updated_by
-- (SUPABASE_SECRET_KEY ข้าม RLS — ถ้าใช้ key นั้น server ยังบังคับ login ที่ middleware อยู่)
alter table public.tasks enable row level security;
alter table public.media enable row level security;
alter table public.budgets enable row level security;
alter table public.profiles enable row level security;

-- ลบ policy เดิมที่เปิดให้ anon อ่าน/เขียนทุกอย่าง
drop policy if exists "app full access" on public.tasks;
drop policy if exists "app full access" on public.media;
drop policy if exists "app full access" on public.budgets;

drop policy if exists "team read" on public.tasks;
create policy "team read" on public.tasks for select to authenticated using (true);
drop policy if exists "team insert" on public.tasks;
create policy "team insert" on public.tasks for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "team update" on public.tasks;
create policy "team update" on public.tasks for update to authenticated using (true) with check (updated_by = auth.uid());
drop policy if exists "team delete" on public.tasks;
create policy "team delete" on public.tasks for delete to authenticated using (true);

drop policy if exists "team read" on public.media;
create policy "team read" on public.media for select to authenticated using (true);
drop policy if exists "team insert" on public.media;
create policy "team insert" on public.media for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "team update" on public.media;
create policy "team update" on public.media for update to authenticated using (true) with check (updated_by = auth.uid());
drop policy if exists "team delete" on public.media;
create policy "team delete" on public.media for delete to authenticated using (true);

drop policy if exists "team read" on public.budgets;
create policy "team read" on public.budgets for select to authenticated using (true);
drop policy if exists "team insert" on public.budgets;
create policy "team insert" on public.budgets for insert to authenticated with check (updated_by = auth.uid());
drop policy if exists "team update" on public.budgets;
create policy "team update" on public.budgets for update to authenticated using (true) with check (updated_by = auth.uid());
drop policy if exists "team delete" on public.budgets;
create policy "team delete" on public.budgets for delete to authenticated using (true);

-- profiles: ทุกคนในทีมเห็นรายชื่อกันได้ (ใช้แสดง "สร้างโดย") — การแก้ไข/เพิ่ม role ทำผ่าน SQL หรือ secret key เท่านั้น
drop policy if exists "team read" on public.profiles;
create policy "team read" on public.profiles for select to authenticated using (true);
