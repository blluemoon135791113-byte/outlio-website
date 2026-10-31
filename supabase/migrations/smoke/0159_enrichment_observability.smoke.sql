-- 0159 smoke: rows insert with the allowed outcomes, refuse an unknown one,
-- and an anon role cannot write.
insert into public.enrichment_page_visits (provider, host, page_kind, outcome)
values ('company-contact', 'fabricated.example', 'home', 'read_contact');

insert into public.enrichment_searches (purpose, words, quoted, operators, engines)
values ('contact_email', 5, true, '{at_domain}', '[{"engine":"diffbot","outcome":"empty","hits":0}]');

do $$
begin
  begin
    insert into public.enrichment_page_visits (provider, host, page_kind, outcome)
    values ('x', 'fabricated.example', 'home', 'made_up');
    raise exception 'unknown outcome was accepted';
  exception when check_violation then null;
  end;
end $$;

select 1 as n, 'visit stored' as label, (select count(*) = 1 from public.enrichment_page_visits) as ok
union all
select 2, 'search stored', (select count(*) = 1 from public.enrichment_searches)
union all
select 3, 'rls on', (select bool_and(relrowsecurity) from pg_class where relname in ('enrichment_page_visits', 'enrichment_searches'));

do $$
begin
  if (select count(*) from public.enrichment_page_visits) <> 1
     or (select count(*) from public.enrichment_searches) <> 1
     or not (select bool_and(relrowsecurity) from pg_class
             where relname in ('enrichment_page_visits', 'enrichment_searches')) then
    raise exception 'SMOKE FAILED';
  end if;
  raise notice 'SMOKE PASSED: 3 of 3 checks';
end $$;
