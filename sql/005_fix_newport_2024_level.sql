-- Newport ran as an ATP 250 in 2024 (its final year on Tour) before dropping to Challenger 125.
-- The edition was created from a Challenger 125 template; correct it here.
update tournament_editions te
set level      = 'ATP 250',
    source     = 'atp_tour_pdf',
    updated_at = now()
from tournaments t
where te.tournament_id = t.id
  and t.slug = 'newport-ri-newport'
  and te.year = 2024;
