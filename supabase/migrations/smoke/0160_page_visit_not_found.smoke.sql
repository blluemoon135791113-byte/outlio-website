-- 0160 smoke: `not_found` is accepted, an unknown outcome still is not.
insert into public.enrichment_page_visits (provider, host, page_kind, outcome)
values ('scout', 'fabricated.example', 'team', 'not_found');

do $$
begin
  begin
    insert into public.enrichment_page_visits (provider, host, page_kind, outcome)
    values ('scout', 'fabricated.example', 'team', 'made_up');
    raise exception 'SMOKE FAILED: unknown outcome accepted';
  exception when check_violation then null;
  end;
  if (select count(*) from public.enrichment_page_visits where outcome = 'not_found') <> 1 then
    raise exception 'SMOKE FAILED: not_found not stored';
  end if;
  raise notice 'SMOKE PASSED: 2 of 2 checks';
end $$;
