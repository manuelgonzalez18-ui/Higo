-- Add current_session_id to profiles table
alter table public.profiles add column current_session_id uuid;
