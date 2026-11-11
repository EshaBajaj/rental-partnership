-- Demo property, questionnaire (v1) and Ideal Profiles (v1).
-- Mirrors apps/web/test/fixtures.ts → seedForm(). Safe to run once on an empty project.

do $$
declare
  prop uuid;
  q uuid;
  ps uuid;
  pr uuid;
begin
  if exists (select 1 from public.properties where slug = 'main-road-shop') then
    raise notice 'seed: already applied';
    return;
  end if;

  insert into public.properties (slug, name) values ('main-road-shop', 'Main Road Shop') returning id into prop;

  -- 0 path
  insert into public.questions (property_id, key, type, label_en, label_hi, position)
  values (prop, 'path', 'single', 'Are you looking to rent this shop or partner with us?', 'क्या आप यह दुकान किराये पर लेना चाहते हैं या हमारे साथ साझेदारी करना चाहते हैं?', 0)
  returning id into q;
  insert into public.question_options (question_id, value, label_en, label_hi, position) values
    (q, 'rent', 'Rent the shop', 'दुकान किराये पर लेना', 0),
    (q, 'partner', 'Partner with us', 'साझेदारी करना', 1),
    (q, 'either', 'Open to either', 'दोनों में से कोई भी', 2);

  -- 1 business_type
  insert into public.questions (property_id, key, type, label_en, label_hi, position, allow_other)
  values (prop, 'business_type', 'single', 'What business do you want to run here?', 'आप यहाँ कौन सा व्यवसाय चलाना चाहते हैं?', 1, true)
  returning id into q;
  insert into public.question_options (question_id, value, label_en, label_hi, position) values
    (q, 'grocery', 'Grocery / Kirana', 'किराना', 0),
    (q, 'pharmacy', 'Pharmacy', 'दवा की दुकान', 1),
    (q, 'clothing', 'Clothing', 'कपड़े', 2),
    (q, 'electronics', 'Mobile & electronics', 'मोबाइल और इलेक्ट्रॉनिक्स', 3),
    (q, 'salon', 'Salon / beauty', 'सैलून / ब्यूटी', 4),
    (q, 'restaurant', 'Restaurant / food', 'रेस्टोरेंट / खाना', 5);

  -- 2 start_when
  insert into public.questions (property_id, key, type, label_en, label_hi, position)
  values (prop, 'start_when', 'single', 'When do you want to start?', 'आप कब शुरू करना चाहते हैं?', 2)
  returning id into q;
  insert into public.question_options (question_id, value, label_en, label_hi, position) values
    (q, 'immediately', 'Immediately', 'तुरंत', 0),
    (q, 'within_1_month', 'Within 1 month', '1 महीने के अंदर', 1),
    (q, '1_3_months', 'In 1–3 months', '1–3 महीने में', 2),
    (q, 'later', 'Later / not sure', 'बाद में / पक्का नहीं', 3);

  -- 3 rent_budget (rent, either)
  insert into public.questions (property_id, key, type, label_en, label_hi, help_en, help_hi, position, validation, show_if)
  values (prop, 'rent_budget', 'currency', 'How much monthly rent can you pay?', 'आप हर महीने कितना किराया दे सकते हैं?',
          'In rupees per month', 'रुपये प्रति माह', 3, '{"min":0,"max":10000000}',
          '{"any":[{"q":"path","op":"in","v":["rent","either"]}]}');

  -- 4 lease_years (rent)
  insert into public.questions (property_id, key, type, label_en, label_hi, position, show_if)
  values (prop, 'lease_years', 'single', 'For how many years do you want the lease?', 'आप कितने साल के लिए लीज़ चाहते हैं?', 4,
          '{"all":[{"q":"path","op":"eq","v":"rent"}]}')
  returning id into q;
  insert into public.question_options (question_id, value, label_en, label_hi, position) values
    (q, '1_2', '1–2 years', '1–2 साल', 0),
    (q, '3_5', '3–5 years', '3–5 साल', 1),
    (q, '5_plus', 'More than 5 years', '5 साल से ज़्यादा', 2);

  -- 5 investment (partner, either)
  insert into public.questions (property_id, key, type, label_en, label_hi, help_en, help_hi, position, validation, show_if)
  values (prop, 'investment', 'currency', 'How much can you invest in the partnership?', 'आप साझेदारी में कितना निवेश कर सकते हैं?',
          'Total amount in rupees', 'कुल रकम रुपये में', 5, '{"min":0}',
          '{"any":[{"q":"path","op":"in","v":["partner","either"]}]}');

  -- 6 partner_role (partner)
  insert into public.questions (property_id, key, type, label_en, label_hi, position, show_if)
  values (prop, 'partner_role', 'single', 'What role would you like in the partnership?', 'साझेदारी में आप क्या भूमिका चाहते हैं?', 6,
          '{"all":[{"q":"path","op":"eq","v":"partner"}]}')
  returning id into q;
  insert into public.question_options (question_id, value, label_en, label_hi, position) values
    (q, 'active', 'Active — I will run the shop', 'सक्रिय — मैं दुकान चलाऊँगा', 0),
    (q, 'sleeping', 'Investor only', 'सिर्फ़ निवेशक', 1);

  -- 7 experience
  insert into public.questions (property_id, key, type, label_en, label_hi, position)
  values (prop, 'experience', 'yes_no', 'Have you run a shop before?', 'क्या आपने पहले कोई दुकान चलाई है?', 7);

  -- 8 about_you (voice, optional)
  insert into public.questions (property_id, key, type, label_en, label_hi, help_en, help_hi, position, required)
  values (prop, 'about_you', 'voice', 'Tell us about your plan', 'अपनी योजना के बारे में बताइए',
          'Tap the mic and speak in Hindi or English, or type.', 'माइक दबाकर हिंदी या अंग्रेज़ी में बोलिए, या लिखिए।', 8, false);

  -- 9 contact
  insert into public.questions (property_id, key, type, label_en, label_hi, position)
  values (prop, 'contact', 'contact', 'How can we reach you?', 'हम आपसे कैसे संपर्क करें?', 9);

  perform public.publish_form(prop);

  -- Ideal Profiles v1
  ps := public.create_profile_draft(prop);
  insert into public.profiles (profile_set_id, name, description, position)
  values (ps, 'Established retailer (rent)', 'Pays market rent, starts soon, long lease.', 0) returning id into pr;
  insert into public.profile_conditions (profile_id, question_key, operator, value, importance, position) values
    (pr, 'path', 'in', '["rent","either"]', 'must', 0),
    (pr, 'rent_budget', 'gte', '40000', 'important', 1),
    (pr, 'start_when', 'in', '["immediately","within_1_month"]', 'important', 2),
    (pr, 'experience', 'eq', '"yes"', 'nice', 3),
    (pr, 'lease_years', 'in', '["3_5","5_plus"]', 'nice', 4);

  insert into public.profiles (profile_set_id, name, description, position)
  values (ps, 'Active partner', 'Invests ₹10 lakh+ and runs the shop day to day.', 1) returning id into pr;
  insert into public.profile_conditions (profile_id, question_key, operator, value, importance, position) values
    (pr, 'path', 'in', '["partner","either"]', 'must', 0),
    (pr, 'investment', 'gte', '1000000', 'important', 1),
    (pr, 'partner_role', 'eq', '"active"', 'important', 2),
    (pr, 'experience', 'eq', '"yes"', 'nice', 3);

  insert into public.never_rules (profile_set_id, question_key, operator, value, label)
  values (ps, 'business_type', 'eq', '"restaurant"', 'No cooking allowed in this building');

  perform public.publish_profile_set(ps);
end $$;
