-- Input modes: answers as arrays, radio→checkbox on a published question keeps old leads matching,
-- live transcript / audio-missing voice meta, legacy voice_finals still accepted.
create or replace function pg_temp.sub(p_id uuid, p_answers jsonb, p_phone text, p_voice jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select public.submit_response(jsonb_build_object(
    'id', p_id, 'property_id', (select id from public.properties), 'form_version_id', (select id from public.form_versions where is_current),
    'path', p_answers #>> '{path,choose,0}', 'answers', p_answers, 'voice', p_voice,
    'name', 'N', 'phone_e164', p_phone, 'whatsapp_ok', true, 'duration_seconds', 120))
$$;

do $$
declare prop uuid := (select id from public.properties); r jsonb; n public.voice_notes;
  a jsonb := '{
    "path": {"choose": ["rent"], "display": "Rent the shop", "question_label": "q"},
    "business_type": {"choose": ["grocery"], "display": "Grocery", "question_label": "q"},
    "start_when": {"choose": ["immediately"], "display": "Immediately", "question_label": "q"},
    "rent_budget": {"text": "45000", "number": 45000, "display": "₹45,000", "question_label": "q"},
    "lease_years": {"choose": ["3_5"], "display": "3–5 years", "question_label": "q"},
    "experience": {"choose": ["yes"], "display": "Yes", "question_label": "q"}}';
begin
  -- new-shape answers match exactly like the legacy ones
  r := pg_temp.sub('f0000000-0000-4000-8000-000000000001', a, '+919700000001');
  perform t.eq(r ->> 'tier', 'ideal', 'array answers → ideal');
  perform t.eq((select best_match from public.responses where id = 'f0000000-0000-4000-8000-000000000001'), 100.0, '8/8 with arrays');
  perform t.eq((select profile_matches -> 0 -> 'matched' -> 1 ->> 'text' from public.responses where id = 'f0000000-0000-4000-8000-000000000001'),
               'How much monthly rent can you pay? ≥ ₹40,000 — answered ₹45,000', 'reason text with number answer');

  -- switch start_when radio → checkbox on the PUBLISHED question, publish, re-match: old lead still matches
  update public.questions set input_modes = jsonb_set(input_modes, '{choose,style}', '"checkbox"') where key = 'start_when';
  perform public.publish_form(prop);
  perform public.publish_profile_set((select id from public.profile_sets where is_current));
  perform t.eq((select tier from public.responses where id = 'f0000000-0000-4000-8000-000000000001'), 'ideal', 'old lead still ideal after radio→checkbox');
  -- a new multi-pick answer: "in" matches if any picked element is in the list
  r := pg_temp.sub('f0000000-0000-4000-8000-000000000002',
        jsonb_set(a, '{start_when}', '{"choose":["later","immediately"],"display":"x","question_label":"q"}'), '+919700000002');
  perform t.eq(r ->> 'tier', 'ideal', 'checkbox picks: any element matches');

  -- spoken with live transcript but no audio stored (silent mic): text kept, audio_missing recorded
  r := pg_temp.sub('f0000000-0000-4000-8000-000000000003',
        a || '{"about_you":{"text":"kirana chalaunga","display":"kirana chalaunga","question_label":"q"}}',
        '+919700000003', '{"about_you":{"final":"kirana chalaunga","live":"kirana chalaunga","audio_missing":true,"has_audio":false}}');
  select * into n from public.voice_notes where response_id = 'f0000000-0000-4000-8000-000000000003';
  perform t.eq(n.storage_path, null::text, 'no audio stored');
  perform t.eq(n.audio_missing, true, 'audio_missing');
  perform t.eq(n.transcript_live, 'kirana chalaunga', 'live kept');
  perform t.eq(n.edited_by_respondent, false, 'final = live → not edited');
  perform t.eq((select answers #>> '{about_you,voice_note_id}' from public.responses where id = 'f0000000-0000-4000-8000-000000000003'), n.id::text, 'answer linked');
  perform t.eq((select count(*) from public.voice_claim_transcribe(10) c where c.id = n.id)::int, 0, 'worker never claims audio-less notes');

  -- recorded audio + live transcript, respondent edited
  perform public.voice_prepare_upload(prop, 'f0000000-0000-4000-8000-000000000004', 'about_you', 'audio/webm', 5000, 8);
  update public.voice_notes set transcript_machine = 'kirana dukan kholna hai', status = 'transcribed' where response_id = 'f0000000-0000-4000-8000-000000000004';
  r := pg_temp.sub('f0000000-0000-4000-8000-000000000004',
        a || '{"about_you":{"text":"Kirana dukaan, 10 saal anubhav","display":"x","question_label":"q"}}',
        '+919700000004', '{"about_you":{"final":"Kirana dukaan, 10 saal anubhav","live":"kirana dukan","audio_missing":false,"has_audio":true}}');
  select * into n from public.voice_notes where response_id = 'f0000000-0000-4000-8000-000000000004';
  perform t.eq(n.edited_by_respondent, true, 'edited vs live and whisper');
  perform t.eq(n.transcript_live, 'kirana dukan', 'live stored');
  perform t.eq(n.transcript_machine, 'kirana dukan kholna hai', 'whisper kept');
  perform t.eq(n.status, 'submitted', 'submitted');

  -- accepting the Whisper version is not an edit
  perform public.voice_prepare_upload(prop, 'f0000000-0000-4000-8000-000000000005', 'about_you', 'audio/webm', 5000, 8);
  update public.voice_notes set transcript_machine = 'clear whisper text' where response_id = 'f0000000-0000-4000-8000-000000000005';
  r := pg_temp.sub('f0000000-0000-4000-8000-000000000005', a || '{"about_you":{"text":"clear whisper text","display":"x","question_label":"q"}}',
        '+919700000005', '{"about_you":{"final":"clear whisper text","live":"blurry live","audio_missing":false,"has_audio":true}}');
  perform t.eq((select edited_by_respondent from public.voice_notes where response_id = 'f0000000-0000-4000-8000-000000000005'), false, 'used Whisper version → not edited');

  -- legacy clients (voice_finals) still work
  perform public.voice_prepare_upload(prop, 'f0000000-0000-4000-8000-000000000006', 'about_you', 'audio/webm', 5000, 8);
  r := public.submit_response(jsonb_build_object('id', 'f0000000-0000-4000-8000-000000000006', 'property_id', prop,
        'form_version_id', (select id from public.form_versions where is_current), 'path', 'rent',
        'answers', jsonb_build_object('path', t.a('"rent"'), 'about_you', jsonb_build_object('value', '', 'display', '(voice note)', 'question_label', 'q')),
        'voice_finals', '{"about_you": ""}'::jsonb, 'name', 'L', 'phone_e164', '+919700000006', 'whatsapp_ok', true, 'duration_seconds', 60));
  perform t.eq((select status from public.voice_notes where response_id = 'f0000000-0000-4000-8000-000000000006'), 'submitted', 'legacy voice_finals');
  -- worker fills a pending NEW-shape answer into `text`
  perform public.voice_prepare_upload(prop, 'f0000000-0000-4000-8000-000000000007', 'about_you', 'audio/webm', 5000, 8);
  r := pg_temp.sub('f0000000-0000-4000-8000-000000000007', a || '{"about_you":{"text":"","display":"(voice note — transcription pending)","question_label":"q"}}',
        '+919700000007', '{"about_you":{"final":"","live":null,"audio_missing":false,"has_audio":true}}');
  perform public.voice_save_transcript((select id from public.voice_notes where response_id = 'f0000000-0000-4000-8000-000000000007'), 'later text', 'english', null);
  perform t.eq((select answers #>> '{about_you,text}' from public.responses where id = 'f0000000-0000-4000-8000-000000000007'), 'later text', 'pending text filled');
end $$;
