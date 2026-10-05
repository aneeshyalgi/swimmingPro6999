-- Coach knowledge moved from Supabase (PDFs in the "Coach Contexts" storage bucket, embedded into
-- coach_context_chunks) into the backend code: app/coach_programs.py and app/coach_sessions.py.
-- Nothing reads these objects any more. Run once in the Supabase SQL editor.

drop function if exists public.match_coach_context_chunks(vector, text[], integer);
drop table if exists public.coach_context_chunks;

-- Only if nothing else in the database uses pgvector (this statement fails safely if something does):
drop extension if exists vector;

-- The "Coach Contexts" storage bucket and its PDFs are no longer read; delete them from Storage when convenient.
