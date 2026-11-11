-- Brand & trust: who the respondent is talking to (shown subtly on every step), speech language,
-- and a public 'brand' bucket for the logo / shop photo (≤ 1 MB, images only).

alter table public.properties
  add column brand_name text not null default 'Bajaj Computers' check (length(btrim(brand_name)) between 1 and 80),
  add column contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  add column contact_whatsapp text check (contact_whatsapp is null or contact_whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  add column address_line text check (length(address_line) <= 200),
  add column logo_url text check (length(logo_url) <= 500),
  add column shop_photo_url text check (length(shop_photo_url) <= 500),
  add column welcome_title_en text check (length(welcome_title_en) <= 120),
  add column welcome_title_hi text check (length(welcome_title_hi) <= 120),
  add column welcome_body_en text check (length(welcome_body_en) <= 500),
  add column welcome_body_hi text check (length(welcome_body_hi) <= 500),
  add column default_speech_lang text not null default 'hi-IN' check (default_speech_lang in ('hi-IN', 'en-IN'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand', 'brand', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- anyone can view (public bucket, served by URL); only admins can add / replace / remove images
create policy "admins upload brand images" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand' and public.is_admin());
create policy "admins update brand images" on storage.objects for update to authenticated
  using (bucket_id = 'brand' and public.is_admin()) with check (bucket_id = 'brand' and public.is_admin());
create policy "admins delete brand images" on storage.objects for delete to authenticated
  using (bucket_id = 'brand' and public.is_admin());
