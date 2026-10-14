-- Preserve the deployed CAS/security/lifecycle implementation verbatim.
-- Audio is a diary attachment, not a visual photo/video memory type.
begin;
set local lock_timeout = '5s';
do $$
declare
  definition text := pg_get_functiondef('moya_private.update_family_memory_details(uuid,uuid,jsonb,jsonb)'::regprocedure);
  before_text text := 'select count(*), count(*) filter (where mf.media_type = ''video'')';
  after_text text := 'select count(*) filter (where mf.media_type in (''image'', ''video'')), count(*) filter (where mf.media_type = ''video'')';
begin
  if strpos(definition, before_text) = 0 then
    raise exception 'Unexpected editor definition: review live function before applying';
  end if;
  execute replace(definition, before_text, after_text);
end;
$$;
notify pgrst, 'reload schema';
commit;
