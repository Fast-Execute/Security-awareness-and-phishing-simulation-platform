-- Checks for launch_campaign, the sending queue, event tracking and stats. "expect" lines state the correct outcome.
\set ON_ERROR_STOP off
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1'),   -- admin of Acme
 ('00000000-0000-0000-0000-0000000000b2');   -- admin of Beta (outsider)

-- ---- setup as Acme admin ----
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset
select create_organization('Acme') as orga \gset
insert into domains(org_id,domain) values (:'orga','acme.co.za');
insert into groups(org_id,name) values (:'orga','Everyone') returning id as grp \gset
reset role;
select set_config('request.jwt.claim.role','service_role',false) \gset
update domains set verified_at = now() where domain = 'acme.co.za';
select set_config('request.jwt.claim.role','authenticated',false) \gset
set role authenticated;
update organizations set aup_accepted_at = now() where id = :'orga';
select import_targets(:'orga', '[{"email":"ann@acme.co.za","full_name":"Ann Smith"},{"email":"bob@acme.co.za"},{"email":"cy@acme.co.za"}]'::jsonb, :'grp') ->> 'inserted' as imported;
-- dan is on a domain Acme has NOT verified; an admin can still create the target row and put it in a group
insert into targets(org_id,email) values (:'orga','dan@other.com');
insert into group_targets select :'grp', id from targets where email = 'dan@other.com';
insert into campaigns(org_id,name,template_id,domain_id)
  select :'orga','Q4 test',(select id from templates where org_id is null order by name limit 1),(select id from domains where domain='acme.co.za')
  returning id as camp \gset

\echo '--- T1 launch (expect 3 recipients: dan on unverified domain excluded; status sending)'
select launch_campaign(:'camp', array[:'grp']::uuid[]) as launched;

\echo '--- T2 launch again (expect error: not a draft)'
select launch_campaign(:'camp', array[:'grp']::uuid[]);

\echo '--- T3 outsider cannot launch or probe the campaign (expect error: campaign not found)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',false) \gset
select launch_campaign(:'camp', array[:'grp']::uuid[]);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset

\echo '--- T4 clients cannot call service-only functions (expect permission denied x3)'
select * from claim_recipients(:'camp');
select record_event('x', 'clicked');
select mark_recipient_sent(gen_random_uuid());

-- ---- sending as service role ----
reset role; set role service_role;
select set_config('request.jwt.claim.role','service_role',false) \gset

\echo '--- T5 claims respect limit and leases (expect 2, then 1, then 0)'
select count(*) as first_claim from claim_recipients(:'camp', 2);
select count(*) as second_claim from claim_recipients(:'camp', 5);
select count(*) as third_claim from claim_recipients(:'camp', 5);

\echo '--- T5b expired lease is claimable again (expect 3)'
select count(*) as reclaimed from claim_recipients(:'camp', 5, interval '0 seconds');

\echo '--- T6 mark 2 sent, 1 failed (expect campaign completed, 2 delivered events)'
select mark_recipient_sent(id) from campaign_recipients where target_id in (select id from targets where email in ('ann@acme.co.za','bob@acme.co.za'));
select mark_recipient_failed(id, 'mailbox does not exist') from campaign_recipients where target_id = (select id from targets where email = 'cy@acme.co.za');
select status from campaigns where id = :'camp';
select count(*) as delivered_events from campaign_events where type = 'delivered';
select mark_recipient_sent(id) from campaign_recipients where status = 'failed';   -- must not flip a failed row
select count(*) filter (where status='failed') as still_failed from campaign_recipients;

select tracking_token as ann_token from campaign_recipients where target_id = (select id from targets where email = 'ann@acme.co.za') \gset
select tracking_token as bob_token from campaign_recipients where target_id = (select id from targets where email = 'bob@acme.co.za') \gset

\echo '--- T7 click right after sending is treated as a scanner (expect recorded false, no training)'
select record_event(:'ann_token', 'clicked', 'Mozilla/5.0') ->> 'recorded' as recorded;
select count(*) as assignments from training_assignments;

\echo '--- T7b real click later (expect recorded true, 1 training assignment, red flags present)'
reset role; update campaign_recipients set sent_at = now() - interval '1 minute'; set role service_role;
select r ->> 'recorded' as recorded, jsonb_array_length(r -> 'red_flags') > 0 as has_red_flags from (select record_event(:'ann_token', 'clicked') as r) x;
select record_event(:'ann_token', 'clicked');
select count(*) as assignments_after_second_click from training_assignments;

\echo '--- T8 unknown token returns null; "delivered" cannot be forged (expect null, then error)'
select record_event(repeat('0', 48), 'clicked') is null as is_null;
select record_event(:'ann_token', 'delivered');

\echo '--- T9 report + stats as admin (expect delivered 2, failed 1, clicked 1, reported 1, 50.0 / 50.0)'
select record_event(:'bob_token', 'reported') ->> 'recorded' as recorded;
reset role; set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false) \gset
select delivered, failed, pending, clicked, reported, click_rate_pct, report_rate_pct from campaign_stats where campaign_id = :'camp';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',false) \gset
\echo '--- T9b outsider sees no stats (expect 0 rows)'
select count(*) as visible_rows from campaign_stats;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset

\echo '--- T10 scheduled campaign: queue empty until due (expect scheduled, 0 claimed, 0 started; then 1 started)'
insert into campaigns(org_id,name,template_id,domain_id)
  select :'orga','Later',(select id from templates where org_id is null limit 1),(select id from domains where domain='acme.co.za')
  returning id as camp2 \gset
select launch_campaign(:'camp2', array[:'grp']::uuid[], now() + interval '1 day') ->> 'status' as status;
reset role; set role service_role;
select set_config('request.jwt.claim.role','service_role',false) \gset
select count(*) as claimed from claim_recipients(:'camp2');
select count(*) as started from start_due_campaigns();
reset role; update campaigns set scheduled_at = now() - interval '1 minute' where id = :'camp2'; set role service_role;
select count(*) as started_when_due from start_due_campaigns();
select count(*) as claimed_when_sending from claim_recipients(:'camp2');
