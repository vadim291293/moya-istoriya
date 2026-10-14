-- Addresses only the two new capsule FK index advisories; no row changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index capsule_vaults_owner_id on moya_private.capsule_vaults(owner_id);
create index family_capsules_child_id on moya_private.family_capsules(child_id);
commit;
