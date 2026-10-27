-- Migration 000015: Add metadata column to public.visits
ALTER TABLE public.visits
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;
