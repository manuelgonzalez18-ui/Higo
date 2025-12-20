alter table public.rides add column rating integer check (rating >= 1 and rating <= 5);
alter table public.rides add column feedback text;
