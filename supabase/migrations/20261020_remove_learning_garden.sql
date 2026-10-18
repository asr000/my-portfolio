-- Retire only the garden's public tag summary. Daily draws and publication
-- history remain in use by the homepage title, so their data and RPCs stay.
begin;
drop function if exists public.public_learning_garden();
notify pgrst, 'reload schema';
commit;
