// Demo mode: used when the app is not connected to a Supabase project (no VITE_SUPABASE_URL),
// e.g. running `npm run dev` on a laptop before setup. The sample form (same as supabase/seed.sql)
// works end to end in the browser; answers are kept only on this device and never sent anywhere.
// Lazy-loaded so it adds nothing to the normal bundle.
import type { FormConfig } from '@shared/types.ts';
import type { PublicProperty } from './api.ts';

export const DEMO_FORM_ID = '00000000-0000-4000-8000-00000000d3e0';

export const DEMO_PROPERTY = (slug: string): PublicProperty => ({
  slug,
  name: 'Main Road Shop (demo)',
  default_lang: 'en',
  brand_name: 'Bajaj Computers',
  contact_phone: null,
  contact_whatsapp: null,
  address_line: 'Main Road',
  logo_url: null,
  shop_photo_url: null,
  welcome_title_en: 'A shop is available on Main Road',
  welcome_title_hi: 'मेन रोड पर एक दुकान उपलब्ध है',
  welcome_body_en: 'Tell us a little about your plans — to rent it, or to run it in partnership with us.',
  welcome_body_hi: 'अपनी योजना के बारे में थोड़ा बताइए — किराये पर लेना चाहते हैं या हमारे साथ साझेदारी में चलाना।',
  default_speech_lang: 'hi-IN',
  audio_retention_days: 180,
});

export const DEMO_CONFIG: FormConfig = {
  "schema": 2,
  "questions": [
    {
      "key": "path",
      "kind": "standard",
      "help_en": null,
      "help_hi": null,
      "options": [
        {
          "value": "rent",
          "label_en": "Rent the shop",
          "label_hi": "दुकान किराये पर लेना"
        },
        {
          "value": "partner",
          "label_en": "Partner with us",
          "label_hi": "साझेदारी करना"
        },
        {
          "value": "either",
          "label_en": "Open to either",
          "label_hi": "दोनों में से कोई भी"
        }
      ],
      "show_if": null,
      "label_en": "Are you looking to rent this shop or partner with us?",
      "label_hi": "क्या आप यह दुकान किराये पर लेना चाहते हैं या हमारे साथ साझेदारी करना चाहते हैं?",
      "required": true,
      "validation": {},
      "input_modes": {
        "type": {
          "format": "any",
          "enabled": false,
          "max_chars": 300,
          "min_chars": null,
          "multiline": false,
          "placeholder_en": null,
          "placeholder_hi": null
        },
        "speak": {
          "enabled": false,
          "allow_edit": true,
          "keep_audio": true,
          "max_seconds": 120,
          "live_transcript": true
        },
        "choose": {
          "style": "radio",
          "enabled": true,
          "max_picks": null,
          "min_picks": null,
          "allow_other": false,
          "other_max_chars": 200
        },
        "primary": "choose"
      }
    },
    {
      "key": "business_type",
      "kind": "standard",
      "help_en": null,
      "help_hi": null,
      "options": [
        {
          "value": "grocery",
          "label_en": "Grocery / Kirana",
          "label_hi": "किराना"
        },
        {
          "value": "pharmacy",
          "label_en": "Pharmacy",
          "label_hi": "दवा की दुकान"
        },
        {
          "value": "clothing",
          "label_en": "Clothing",
          "label_hi": "कपड़े"
        },
        {
          "value": "electronics",
          "label_en": "Mobile & electronics",
          "label_hi": "मोबाइल और इलेक्ट्रॉनिक्स"
        },
        {
          "value": "salon",
          "label_en": "Salon / beauty",
          "label_hi": "सैलून / ब्यूटी"
        },
        {
          "value": "restaurant",
          "label_en": "Restaurant / food",
          "label_hi": "रेस्टोरेंट / खाना"
        }
      ],
      "show_if": null,
      "label_en": "What business do you want to run here?",
      "label_hi": "आप यहाँ कौन सा व्यवसाय चलाना चाहते हैं?",
      "required": true,
      "validation": {},
      "input_modes": {
        "type": {
          "format": "any",
          "enabled": false,
          "max_chars": 300,
          "min_chars": null,
          "multiline": false,
          "placeholder_en": null,
          "placeholder_hi": null
        },
        "speak": {
          "enabled": false,
          "allow_edit": true,
          "keep_audio": true,
          "max_seconds": 120,
          "live_transcript": true
        },
        "choose": {
          "style": "radio",
          "enabled": true,
          "max_picks": null,
          "min_picks": null,
          "allow_other": true,
          "other_max_chars": 200
        },
        "primary": "choose"
      }
    },
    {
      "key": "start_when",
      "kind": "standard",
      "help_en": null,
      "help_hi": null,
      "options": [
        {
          "value": "immediately",
          "label_en": "Immediately",
          "label_hi": "तुरंत"
        },
        {
          "value": "within_1_month",
          "label_en": "Within 1 month",
          "label_hi": "1 महीने के अंदर"
        },
        {
          "value": "1_3_months",
          "label_en": "In 1–3 months",
          "label_hi": "1–3 महीने में"
        },
        {
          "value": "later",
          "label_en": "Later / not sure",
          "label_hi": "बाद में / पक्का नहीं"
        }
      ],
      "show_if": null,
      "label_en": "When do you want to start?",
      "label_hi": "आप कब शुरू करना चाहते हैं?",
      "required": true,
      "validation": {},
      "input_modes": {
        "type": {
          "format": "any",
          "enabled": false,
          "max_chars": 300,
          "min_chars": null,
          "multiline": false,
          "placeholder_en": null,
          "placeholder_hi": null
        },
        "speak": {
          "enabled": false,
          "allow_edit": true,
          "keep_audio": true,
          "max_seconds": 120,
          "live_transcript": true
        },
        "choose": {
          "style": "radio",
          "enabled": true,
          "max_picks": null,
          "min_picks": null,
          "allow_other": false,
          "other_max_chars": 200
        },
        "primary": "choose"
      }
    },
    {
      "key": "rent_budget",
      "kind": "standard",
      "help_en": "In rupees per month",
      "help_hi": "रुपये प्रति माह",
      "options": [],
      "show_if": {
        "any": [
          {
            "q": "path",
            "v": [
              "rent",
              "either"
            ],
            "op": "in"
          }
        ]
      },
      "label_en": "How much monthly rent can you pay?",
      "label_hi": "आप हर महीने कितना किराया दे सकते हैं?",
      "required": true,
      "validation": {
        "max": 10000000,
        "min": 0
      },
      "input_modes": {
        "type": {
          "format": "currency",
          "enabled": true,
          "max_chars": 15,
          "min_chars": null,
          "multiline": false,
          "placeholder_en": "50000",
          "placeholder_hi": null
        },
        "speak": {
          "enabled": false,
          "allow_edit": true,
          "keep_audio": true,
          "max_seconds": 120,
          "live_transcript": true
        },
        "choose": {
          "style": "radio",
          "enabled": false,
          "max_picks": null,
          "min_picks": null,
          "allow_other": false,
          "other_max_chars": 200
        },
        "primary": "type"
      }
    },
    {
      "key": "lease_years",
      "kind": "standard",
      "help_en": null,
      "help_hi": null,
      "options": [
        {
          "value": "1_2",
          "label_en": "1–2 years",
          "label_hi": "1–2 साल"
        },
        {
          "value": "3_5",
          "label_en": "3–5 years",
          "label_hi": "3–5 साल"
        },
        {
          "value": "5_plus",
          "label_en": "More than 5 years",
          "label_hi": "5 साल से ज़्यादा"
        }
      ],
      "show_if": {
        "all": [
          {
            "q": "path",
            "v": "rent",
            "op": "eq"
          }
        ]
      },
      "label_en": "For how many years do you want the lease?",
      "label_hi": "आप कितने साल के लिए लीज़ चाहते हैं?",
      "required": true,
      "validation": {},
      "input_modes": {
        "type": {
          "format": "any",
          "enabled": false,
          "max_chars": 300,
          "min_chars": null,
          "multiline": false,
          "placeholder_en": null,
          "placeholder_hi": null
        },
        "speak": {
          "enabled": false,
          "allow_edit": true,
          "keep_audio": true,
          "max_seconds": 120,
          "live_transcript": true
        },
        "choose": {
          "style": "radio",
          "enabled": true,
          "max_picks": null,
          "min_picks": null,
          "allow_other": false,
          "other_max_chars": 200
        },
        "primary": "choose"
      }
    },
    {
      "key": "investment",
      "kind": "standard",
      "help_en": "Total amount in rupees",
      "help_hi": "कुल रकम रुपये में",
      "options": [],
      "show_if": {
        "any": [
          {
            "q": "path",
            "v": [
              "partner",
              "either"
            ],
            "op": "in"
          }
        ]
      },
      "label_en": "How much can you invest in the partnership?",
      "label_hi": "आप साझेदारी में कितना निवेश कर सकते हैं?",
      "required": true,
      "validation": {
        "min": 0
      },
      "input_modes": {
        "type": {
          "format": "currency",
          "enabled": true,
          "max_chars": 15,
          "min_chars": null,
          "multiline": false,
          "placeholder_en": "50000",
          "placeholder_hi": null
        },
        "speak": {
          "enabled": false,
          "allow_edit": true,
          "keep_audio": true,
          "max_seconds": 120,
          "live_transcript": true
        },
        "choose": {
          "style": "radio",
          "enabled": false,
          "max_picks": null,
          "min_picks": null,
          "allow_other": false,
          "other_max_chars": 200
        },
        "primary": "type"
      }
    },
    {
      "key": "partner_role",
      "kind": "standard",
      "help_en": null,
      "help_hi": null,
      "options": [
        {
          "value": "active",
          "label_en": "Active — I will run the shop",
          "label_hi": "सक्रिय — मैं दुकान चलाऊँगा"
        },
        {
          "value": "sleeping",
          "label_en": "Investor only",
          "label_hi": "सिर्फ़ निवेशक"
        }
      ],
      "show_if": {
        "all": [
          {
            "q": "path",
            "v": "partner",
            "op": "eq"
          }
        ]
      },
      "label_en": "What role would you like in the partnership?",
      "label_hi": "साझेदारी में आप क्या भूमिका चाहते हैं?",
      "required": true,
      "validation": {},
      "input_modes": {
        "type": {
          "format": "any",
          "enabled": false,
          "max_chars": 300,
          "min_chars": null,
          "multiline": false,
          "placeholder_en": null,
          "placeholder_hi": null
        },
        "speak": {
          "enabled": false,
          "allow_edit": true,
          "keep_audio": true,
          "max_seconds": 120,
          "live_transcript": true
        },
        "choose": {
          "style": "radio",
          "enabled": true,
          "max_picks": null,
          "min_picks": null,
          "allow_other": false,
          "other_max_chars": 200
        },
        "primary": "choose"
      }
    },
    {
      "key": "experience",
      "kind": "yes_no",
      "help_en": null,
      "help_hi": null,
      "options": [
        {
          "value": "yes",
          "label_en": "Yes",
          "label_hi": "हाँ"
        },
        {
          "value": "no",
          "label_en": "No",
          "label_hi": "नहीं"
        }
      ],
      "show_if": null,
      "label_en": "Have you run a shop before?",
      "label_hi": "क्या आपने पहले कोई दुकान चलाई है?",
      "required": true,
      "validation": {},
      "input_modes": null
    },
    {
      "key": "about_you",
      "kind": "standard",
      "help_en": "Tap the mic and speak in Hindi or English, or type.",
      "help_hi": "माइक दबाकर हिंदी या अंग्रेज़ी में बोलिए, या लिखिए।",
      "options": [],
      "show_if": null,
      "label_en": "Tell us about your plan",
      "label_hi": "अपनी योजना के बारे में बताइए",
      "required": false,
      "validation": {},
      "input_modes": {
        "type": {
          "format": "any",
          "enabled": true,
          "max_chars": 1000,
          "min_chars": null,
          "multiline": true,
          "placeholder_en": null,
          "placeholder_hi": null
        },
        "speak": {
          "enabled": true,
          "allow_edit": true,
          "keep_audio": true,
          "max_seconds": 120,
          "live_transcript": true
        },
        "choose": {
          "style": "radio",
          "enabled": false,
          "max_picks": null,
          "min_picks": null,
          "allow_other": false,
          "other_max_chars": 200
        },
        "primary": "speak"
      }
    },
    {
      "key": "contact",
      "kind": "contact",
      "help_en": null,
      "help_hi": null,
      "options": [],
      "show_if": null,
      "label_en": "How can we reach you?",
      "label_hi": "हम आपसे कैसे संपर्क करें?",
      "required": true,
      "validation": {},
      "input_modes": null
    }
  ]
} as FormConfig;
