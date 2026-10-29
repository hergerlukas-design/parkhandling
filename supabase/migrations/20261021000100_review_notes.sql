-- =============================================================================
-- Kommentare zur Vorschau der Landingpage (Review-Modus)
--  * Schreiben und Lesen nur über die Edge Function review-notes (prüft REVIEW_TOKEN)
--  * Keine Policies: anonyme Clients greifen nicht direkt zu
-- =============================================================================

create table public.review_notes (
  id uuid primary key default gen_random_uuid(),
  page text not null check (char_length(page) <= 200),
  section text not null check (char_length(section) <= 100),
  body text not null check (char_length(body) between 1 and 1000),
  author text check (char_length(author) <= 60),
  status text not null default 'offen' check (status in ('offen', 'erledigt')),
  created_at timestamptz not null default now()
);

create index review_notes_created_idx on public.review_notes (created_at desc);

alter table public.review_notes enable row level security;
