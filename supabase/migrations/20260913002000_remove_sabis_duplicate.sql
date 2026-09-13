-- 20260913001900 moved "SABIS International School of Choueifat Erbil" from Kenya to
-- Iraq, where ISR had already listed it as "SABIS International School Choueifat
-- Erbil" (no "of"). That created a duplicate — the check in that migration only
-- looked at exact names. Remove the moved copy; it has no postings.
delete from public.schools
 where country = 'Iraq' and name = 'SABIS International School of Choueifat Erbil'
   and not exists (select 1 from public.postings p where p.school_id = schools.id);
