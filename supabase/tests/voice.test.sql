-- Voice notes: upload limits, transcription lifecycle, submit, pending fill-in, failures, retention.
do $$
declare prop uuid := (select id from public.properties where slug = 'main-road-shop');
  rid uuid := 'd0000000-0000-4000-8000-000000000001'; rid2 uuid := 'd0000000-0000-4000-8000-000000000002';
  r jsonb; nid uuid; row public.responses; n public.voice_notes; cnt int;
begin
  -- recordings per question
  r := public.voice_prepare_upload(prop, rid, 'about_you', 'audio/webm', 1000, 20);
  perform t.eq(r ->> 'path', prop || '/' || rid || '/about_you-1.webm', 'path');
  r := public.voice_prepare_upload(prop, rid, 'about_you', 'audio/mp4', 1000, 25);
  perform t.eq(r ->> 'previous_path', prop || '/' || rid || '/about_you-1.webm', 'previous path returned for cleanup');
  perform t.eq(r ->> 'path', prop || '/' || rid || '/about_you-2.m4a', 'mp4 → m4a');
  r := public.voice_prepare_upload(prop, rid, 'about_you', 'audio/webm', 1000, 30);
  perform t.throws(format('select public.voice_prepare_upload(%L, %L, %L, %L, 1, 1)', prop, rid, 'about_you', 'audio/webm'), 'too_many_recordings', '3 per question');
  perform t.eq((select count(*) from public.voice_notes where response_id = rid)::int, 1, 'one row per question');
  -- total audio per response
  perform t.throws(format('select public.voice_prepare_upload(%L, %L, %L, %L, 1, 280)', prop, rid, 'other_q', 'audio/webm'), 'audio_limit', '5 min total');
  perform t.throws(format('select public.voice_prepare_upload(%L, %L, %L, %L, 1, 10)', prop, rid, 'x', 'video/mp4'), 'bad_mime', 'mime');

  -- transcribe-now lifecycle
  r := public.voice_begin_transcribe(rid, 'about_you');
  perform t.eq(r ->> 'done', 'false', 'begin');
  nid := (r ->> 'id')::uuid;
  perform t.eq((select status from public.voice_notes where id = nid), 'transcribing', 'transcribing');
  perform public.voice_save_transcript(nid, 'mujhe kirana dukaan kholni hai', 'hindi', 29.5);
  perform t.eq((select status from public.voice_notes where id = nid), 'transcribed', 'transcribed');
  r := public.voice_begin_transcribe(rid, 'about_you');
  perform t.eq(r ->> 'text', 'mujhe kirana dukaan kholni hai', 'cached transcript returned');

  -- submit with an edited transcript
  r := public.submit_response(jsonb_build_object('id', rid, 'property_id', prop,
    'form_version_id', (select id from public.form_versions where is_current), 'path', 'rent',
    'answers', jsonb_build_object('path', t.a('"rent"'), 'business_type', t.a('"grocery"'), 'start_when', t.a('"immediately"'),
       'rent_budget', t.a('45000'), 'lease_years', t.a('"3_5"'), 'experience', t.a('"yes"'),
       'about_you', t.a('"Mujhe kirana dukaan kholni hai, 10 saal ka anubhav"')),
    'voice_finals', jsonb_build_object('about_you', 'Mujhe kirana dukaan kholni hai, 10 saal ka anubhav'),
    'name', 'V', 'phone_e164', '+919822222222', 'whatsapp_ok', true, 'duration_seconds', 150));
  select * into n from public.voice_notes where id = nid;
  perform t.eq(n.status, 'submitted', 'note submitted');
  perform t.eq(n.edited_by_respondent, true, 'edited flag');
  perform t.eq(n.transcript_final, 'Mujhe kirana dukaan kholni hai, 10 saal ka anubhav', 'final saved');
  select * into row from public.responses where id = rid;
  perform t.eq(row.answers #>> '{about_you,voice_note_id}', nid::text, 'answer links note');
  perform t.eq(row.intent_score, 100, 'intent: 40 + voice 25 + optional 15 + wa 10 + duration 10');
  perform t.throws(format('select public.voice_prepare_upload(%L, %L, %L, %L, 1, 1)', prop, rid, 'about_you', 'audio/webm'), 'already_submitted', 'no uploads after submit');

  -- translation queue (Hindi) and save
  perform t.eq((select count(*) from public.voice_claim_translate(5))::int, 1, 'claimed for translation');
  perform public.voice_save_translation(nid, 'I want to open a grocery shop, 10 years of experience');
  perform t.eq((select count(*) from public.voice_claim_translate(5))::int, 0, 'nothing left to translate');

  -- pending: submit before transcript exists → worker fills the answer later
  perform public.voice_prepare_upload(prop, rid2, 'about_you', 'audio/ogg', 1000, 12);
  update public.voice_notes set status = 'uploaded' where response_id = rid2;
  r := public.submit_response(jsonb_build_object('id', rid2, 'property_id', prop,
    'form_version_id', (select id from public.form_versions where is_current), 'path', 'rent',
    'answers', jsonb_build_object('path', t.a('"rent"'), 'about_you', jsonb_build_object('value', '', 'display', '(voice note — transcription pending)', 'question_label', 'q')),
    'voice_finals', jsonb_build_object('about_you', ''),
    'name', 'P', 'phone_e164', '+919833333333', 'whatsapp_ok', true, 'duration_seconds', 100));
  select * into n from public.voice_notes where response_id = rid2;
  perform t.eq(n.status, 'submitted', 'pending note submitted');
  perform t.eq(n.edited_by_respondent, false, 'not edited');
  perform t.eq((select (match_detail -> 'intent_breakdown' ->> 'voice')::int from public.responses where id = rid2), 25, 'pending voice counts');
  select count(*) into cnt from public.voice_claim_transcribe(5) c where c.id = n.id;
  perform t.eq(cnt, 1, 'worker claims pending submitted note');
  perform public.voice_save_transcript(n.id, 'Main dawai ki dukaan chalata hoon', 'hindi', null);
  select * into row from public.responses where id = rid2;
  perform t.eq(row.answers #>> '{about_you,value}', 'Main dawai ki dukaan chalata hoon', 'answer filled from transcript');
  perform t.eq((select transcript_final from public.voice_notes where id = n.id), 'Main dawai ki dukaan chalata hoon', 'final = machine');
  perform t.eq((select count(*) from public.lead_events where response_id = rid2 and type = 'voice_transcribed')::int, 1, 'event logged');

  -- failures: backoff, then failed + event after 6 attempts
  perform public.voice_prepare_upload(prop, 'd0000000-0000-4000-8000-000000000003', 'about_you', 'audio/webm', 1000, 5);
  select id into nid from public.voice_notes where response_id = 'd0000000-0000-4000-8000-000000000003';
  update public.voice_notes set transcribe_attempts = 1 where id = nid;
  perform public.voice_mark_failed(nid, 'groq 429', 60);
  select * into n from public.voice_notes where id = nid;
  perform t.eq(n.status, 'uploaded', 'retryable');
  perform t.ok(n.next_attempt_at > now() + interval '50 seconds', 'backoff scheduled');
  update public.voice_notes set transcribe_attempts = 6 where id = (select id from public.voice_notes where response_id = rid2);
  update public.voice_notes set transcript_machine = null where response_id = rid2;
  perform public.voice_mark_failed((select id from public.voice_notes where response_id = rid2), 'gave up', 60);
  perform t.eq((select status from public.voice_notes where response_id = rid2), 'failed', 'failed after 6');
  perform t.eq((select count(*) from public.lead_events where response_id = rid2 and type = 'voice_failed')::int, 1, 'failure visible on lead');

  -- retention
  update public.voice_notes set created_at = now() - interval '200 days' where response_id = rid;
  perform t.eq((select count(*) from public.audio_expired(50) e where e.storage_path like '%' || rid || '%')::int, 1, 'expired audio listed');
  perform public.audio_mark_deleted(array[(select id from public.voice_notes where response_id = rid)]);
  perform t.ok((select audio_deleted_at is not null and transcript_final is not null from public.voice_notes where response_id = rid), 'audio gone, transcript kept');
end $$;

-- notifications + rate limit
do $$
declare n public.notifications; i int; ok boolean;
begin
  perform t.submit('e0000000-0000-4000-8000-000000000001', jsonb_build_object('path', t.a('"rent"'), 'business_type', t.a('"grocery"'),
    'start_when', t.a('"immediately"'), 'rent_budget', t.a('45000'), 'lease_years', t.a('"3_5"'), 'experience', t.a('"yes"')), '+919844444444');
  select * into n from public.notification_claim(10, 'e0000000-0000-4000-8000-000000000001');
  perform t.eq(n.attempts, 1, 'claimed');
  perform t.eq((select count(*) from public.notification_claim(10, 'e0000000-0000-4000-8000-000000000001'))::int, 0, 'leased, not re-claimed');
  perform public.notification_done(n.id, false, 'telegram down');
  perform t.eq((select status from public.notifications where id = n.id), 'pending', 'still pending after failure');
  update public.notifications set attempts = 8 where id = n.id;
  perform public.notification_done(n.id, false, 'telegram down');
  perform t.eq((select status from public.notifications where id = n.id), 'failed', 'failed after 8');
  perform t.eq((select count(*) from public.lead_events where type = 'notify_failed')::int, 1, 'notify failure visible');

  for i in 1..5 loop
    ok := public.rate_limit_hit('submit', 'ip1', 5, 3600);
    perform t.eq(ok, true, 'within limit ' || i);
  end loop;
  perform t.eq(public.rate_limit_hit('submit', 'ip1', 5, 3600), false, '6th blocked');
  perform t.eq(public.rate_limit_hit('submit', 'ip2', 5, 3600), true, 'other ip fine');
  perform t.ok((public.health_snapshot() ->> 'notify_failed')::int = 1, 'health snapshot');
end $$;
