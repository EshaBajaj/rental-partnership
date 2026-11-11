# Admin guide — Shop Lead Screener

This guide is for the shop owner and staff. It explains how to read the leads board, change the questionnaire safely, and tune how leads are ranked.

---

## 1. Signing in

1. Open `https://<your-site>/admin` and sign in with your email and password.
2. Forgot your password? Type your email and tap **Forgot password**; a reset link is emailed to you.
3. If you see **“Your account is not an admin”**, your login exists but the owner has not added you yet (Settings → Admins).

There are two roles:

| Role | Can do |
|---|---|
| **Owner** | Everything, including adding/removing admins |
| **Staff** | Everything except managing admins |

Every change to questions, profiles, settings, admins and lead status is recorded in **Audit** with who did it and when.

---

## 2. The leads board (the main screen)

Each card is one person who filled in the form. Cards are ordered:

1. **Pinned** leads first (tap ☆ to pin),
2. then by **tier**: 🟢 **Ideal** → 🟡 **Maybe** → ⚪ **Not a fit**,
3. then by **priority** (highest first),
4. then newest first.

New leads appear by themselves (no refresh needed) with a small “New lead” message.

### What a card shows

- **Name, phone (tap to call), WhatsApp** (only if they said WhatsApp is OK).
- **Wants to**: Rent, Partner, Either, or Waitlist (form was closed).
- **Best profile and match %** — the Ideal Profile they fit best. **near miss** means they would have matched well, but one *must have* condition was not met.
- **Reasons**: ✓ conditions they meet, ✗ must-haves they failed, – conditions they missed.
- ⛔ **Never rule** labels, if one was hit.
- **duplicate** — the same phone number filled the form in the last 30 days (tap to open the earlier lead). Duplicates are hidden by default.
- **suspected bot** — finished in under 15 seconds. Hidden by default.
- **Status** dropdown: New → Contacted → Visit scheduled → Negotiating → Won / Lost (you’ll be asked for a reason when marking Lost).

### Filters, saved views, export

- Tap the tier pills (Ideal / Maybe / Not a fit) for a quick filter.
- **Filters** adds status, path, best profile, dates, and “include duplicates / suspected bots”.
- Type a name or part of a phone number in the search box.
- **Save** the current filters under a name (e.g. “Hot renters”) and reuse them with one tap. Saved views are private to you.
- **Export CSV** downloads the current list including every answer (opens in Excel / Google Sheets).

### Why is a lead ranked where it is?

Open a lead. The **Why this ranking** box explains everything:

- **Priority = match share × best match % + intent share × intent score** (defaults 0.7 and 0.3).
- Every profile is listed with its match %, whether the lead qualifies, and each condition’s result in plain words, e.g. *“How much monthly rent can you pay? ≥ ₹40,000 — answered ₹45,000”*.
- **Intent** (0–100) shows which signals counted: when they want to start, answered by voice, answered all optional questions, OK to WhatsApp, took a normal amount of time.
- **Re-match now** re-ranks this one lead with the current profiles (normally automatic).

### Following up

On the lead page you can change the status, pin, **log a call / WhatsApp / visit**, and write **notes**. Notes are kept on your device until you tap **Save notes**, so nothing is lost if your connection drops. The **Timeline** shows everything that happened to the lead: submitted, tier changes (and why), status changes, alerts sent, voice transcribed.

### Voice notes

Respondents can answer some questions by speaking. On the lead page you can:

- **Load audio** and listen (links are private and expire after one hour).
- Read **what the respondent sent** and, if they edited it, the original **machine transcript** (marked *edited by respondent*).
- Read an **English translation** when they spoke Hindi or another language.

If someone sent a recording before the transcript was ready, it is transcribed in the background within a few minutes and the answer is filled in automatically. Recordings are deleted after the retention period (Settings); transcripts are kept.

---

## 3. Building the questionnaire (Form)

Changes are saved automatically as a **draft** (watch for “Saved ✓”). Respondents see nothing until you **Publish**.

### The rules that keep the form working

- The first question is always **Rent / Partner / Either** (key `path`). You can change its wording, but not its answers or position; it decides which questions follow.
- There must be exactly **one Contact details** question, shown to everyone. It is a single screen: name, mobile number, “OK to WhatsApp” and a consent tick box.
- Choice questions need **at least two options**.
- Aim for **9 screens or fewer** per path (shown at the top as *rent / partner / either* counts) so people finish in about 2 minutes.

Problems appear **immediately**, next to the question and in the summary at the top, after every edit or reorder. **Publish** stays disabled until they are fixed. Messages say exactly what to do, e.g. *“How many years?” depends on “Have you run a shop before?”, but “Have you run a shop before?” comes after it. Move …*

### Adding and editing

- **Add a question** at the bottom; it is placed just above the contact question.
- Tap a question to open it: type, text in English and Hindi, help text, required, “Allow Other (typed)”, “Allow answering by voice”, limits (minimum/maximum, maximum length, pick at least / at most), and answer options.
- Reorder by dragging the ⠿ handle (or the ▲▼ arrows).
- The **key** is the question’s permanent internal name. You can change it only until the first publish.
- An option’s internal value is created from its label and is locked 🔒 once published; you can always reword the label.

### When to show a question (conditions)

Open **When to show this question** → **Only show when…**, then build rules like *Rent / Partner / Either is one of Rent, Either*. You can combine rules with **ALL** (every rule true) or **ANY** (at least one), and nest groups. Conditions can only use questions **above** this one. If a question is hidden for someone, it is skipped and any answer they typed for it earlier is discarded.

### Deleting vs archiving

- A question or option that was **never published** is **deleted**.
- Once **published**, it can only be **archived**: new respondents no longer see it, and old leads keep their answers. Archived questions are listed at the bottom and can be **restored**. Their keys stay reserved.
- If the item is used elsewhere — in another question’s conditions, an Ideal Profile, or a never rule — you get a list of **every** place it is used, with **Remove from these too** or **Cancel**. Nothing is removed silently. If your *live* profiles use it, a profiles draft is created and changed; publish that draft on the Profiles page.

### Changing a question’s type

- Single choice ↔ Dropdown and Short text ↔ Long text are changed in place.
- Other changes on a **published** question (e.g. single → multiple choice) cannot convert old answers. You are asked for a new key; the old question is archived (old leads keep it), a new one is created, and conditions and draft profile conditions are pointed to it. Review them afterwards, then publish the form and the profiles draft.

### Publishing and versions

**Publish** creates a new, permanent version. People already filling in the form finish on the version they started. **Versions** lists every published version; **View** shows its questions and **Restore** makes an old version live again (your draft is untouched). **Open live form ↗** shows what respondents see.

---

## 4. Ideal Profiles (who you want)

A profile is a combination of answers you would love to see, e.g. *“Established retailer: wants to rent, can pay ≥ ₹40,000, starts within a month, has run a shop before.”*

### Condition importance

| Importance | Effect |
|---|---|
| **Must have** | If not met, the lead does not qualify for this profile (still shown as a *near miss*). |
| **Important** | Counts 3× toward the match %. |
| **Nice to have** | Counts 1× toward the match %. |

Match % = points met ÷ points possible, counting only questions the person actually saw. A renter is never penalised for skipping partner-only questions.

**Tiers**: Ideal when the person qualifies for a profile and its match % ≥ 80; Maybe when the best match ≥ 50; otherwise Not a fit. A near miss is at most Maybe. You can change the weights and thresholds under **Scoring settings**.

### Never rules

Things that rule a lead out completely (e.g. *“No cooking allowed in this building”* when the business is a restaurant). Any hit makes the lead **Not a fit**, with the label shown on the card.

### Editing safely: draft → simulate → publish

1. Published profiles can’t be edited directly. Tap **Edit (create draft)** to get a copy.
2. Change profiles, conditions, never rules and scoring settings. Changes save automatically.
3. Each profile shows a **live counter**: *“12 of 40 current leads qualify · 5 would be Ideal”*, updated as you edit.
4. **Simulate** shows how many leads would move between tiers and lists each changed lead. Nothing changes yet.
5. **Publish** re-ranks every lead in one step. Each tier change appears on that lead’s timeline.
6. Changed your mind? Under **Published versions**, **Roll back to this** re-publishes an older version, which also re-ranks every lead.

**Discard draft** throws the draft away; the live profiles stay as they are.

### Intent score

Intent (0–100) measures how serious someone seems: when they want to start (e.g. Immediately 40, Within 1 month 30, 1–3 months 15, Later 0), +25 for answering by voice, +15 for answering every optional question, +10 for OK to WhatsApp, +10 for taking a normal time (30 s–15 min). You can change all of these in **Scoring settings**.

---

## 5. Settings

- **Property**: name, default language, how long to keep voice recordings (audio is deleted after this; transcripts stay), and the message shown when the form is closed.
- **Close form / Open form**: when closed, visitors see your message and can join the waitlist (leads with path *Waitlist*).
- **QR code**: download a PNG or print the bilingual **poster** for the shop shutter. The link includes `?src=qr`, so these leads show source *qr*.
- **Telegram alerts**: every Ideal lead is sent to your Telegram chat. **Send test message** checks the setup. If Telegram is down, alerts are retried, and a permanent failure is shown on the lead’s timeline.
- **Change my password**.
- **Admins** (owner only): first invite the person in Supabase → Authentication → Users, then add their email here as Staff or Owner. You can change roles or remove admins, but not yourself.

---

## 6. Funnel

**Funnel** shows, for a date range, how many people opened the form, started, answered each question, and submitted. It also shows the drop-off at each step, the completion rate and the median time to finish. A big drop at one question means it is worth rewording or making optional.
