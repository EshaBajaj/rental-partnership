// Lead detail: answers, voice notes, full explanation of the ranking, lead management, timeline.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { formatPhone, whatsappDigits } from '@shared/phone.ts';
import type { ContactValue, FormConfig } from '@shared/types.ts';
import { must, qk, rpc, supabase } from '../api.ts';
import { useAdmin } from '../context.tsx';
import type { AdminRow, LeadEventRow, ProfileMatchJson, ProfileSetRow, ResponseRow, VoiceNoteRow } from '../types.ts';
import { Badge, ErrorBox, SaveIndicator, type SaveState, Spinner, TierBadge, useToast } from '../ui.tsx';
import { PinButton, StatusControl, useUpdateLead } from '../board/leadMutations.tsx';
import { PATH_LABEL } from '../board/LeadCard.tsx';
import { eventText } from './events.ts';

export function LeadDetail() {
  const { id = '' } = useParams();
  const lead = useQuery({
    queryKey: qk.lead(id),
    queryFn: async () => must(await supabase.from('responses').select('*').eq('id', id).maybeSingle()) as ResponseRow | null,
  });
  const config = useQuery({
    queryKey: ['form-config', lead.data?.form_version_id],
    enabled: !!lead.data?.form_version_id,
    queryFn: async () =>
      (must(await supabase.from('form_versions').select('config, version').eq('id', lead.data!.form_version_id!).single()) as { config: FormConfig; version: number }),
  });

  if (lead.isLoading) return <Spinner />;
  if (lead.error) return <ErrorBox error={lead.error} onRetry={() => lead.refetch()} />;
  if (!lead.data) return <ErrorBox error="This lead does not exist." />;
  const l = lead.data;

  return (
    <div className="space-y-4">
      <Link to="/admin" className="text-sm text-stone-500 hover:underline">
        ← All leads
      </Link>
      <header className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={l.tier} />
          <h1 className="text-xl font-semibold">{l.name}</h1>
          <Badge>{PATH_LABEL[l.path]}</Badge>
          {l.duplicate_of && (
            <Link to={`/admin/leads/${l.duplicate_of}`}>
              <Badge tone="violet">duplicate of earlier lead ↗</Badge>
            </Link>
          )}
          {l.suspected_bot && <Badge tone="red">suspected bot ({l.duration_seconds}s)</Badge>}
          <div className="ml-auto">
            <PinButton lead={l} />
          </div>
        </div>
        <p className="mt-1 text-sm text-stone-500">
          {format(new Date(l.created_at), 'd MMM yyyy, HH:mm')} ({formatDistanceToNowStrict(new Date(l.created_at), { addSuffix: true })}) · took{' '}
          {Math.round(l.duration_seconds / 6) / 10} min · {l.lang === 'hi' ? 'Hindi' : 'English'} · source {l.source}
          {config.data ? ` · form v${config.data.version}` : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-primary" href={`tel:${l.phone_e164}`}>
            📞 Call {formatPhone(l.phone_e164)}
          </a>
          {l.whatsapp_ok ? (
            <a className="btn-secondary" href={`https://wa.me/${whatsappDigits(l.phone_e164)}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          ) : (
            <Badge>No WhatsApp</Badge>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Ranking lead={l} />
          <Answers lead={l} config={config.data?.config ?? null} />
          <VoiceNotes lead={l} />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Manage lead={l} />
          <Timeline lead={l} />
        </div>
      </div>
    </div>
  );
}

function Ranking({ lead }: { lead: ResponseRow }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sets = useQuery({
    queryKey: ['profile-set-settings', lead.profile_set_id],
    enabled: !!lead.profile_set_id,
    queryFn: async () => must(await supabase.from('profile_sets').select('*').eq('id', lead.profile_set_id!).single()) as ProfileSetRow,
  });
  const rematch = useMutation({
    mutationFn: () => rpc('apply_match', { p_response_id: lead.id }),
    onSuccess: () => {
      toast('Re-matched with the current profiles', 'success');
      qc.invalidateQueries({ queryKey: qk.lead(lead.id) });
      qc.invalidateQueries({ queryKey: qk.leadEvents(lead.id) });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const pr = (sets.data?.settings as { priority?: { match?: number; intent?: number } } | undefined)?.priority;
  const pm = pr?.match ?? 0.7;
  const pi = pr?.intent ?? 0.3;
  const ib = lead.match_detail?.intent_breakdown ?? {};
  const INTENT_LABEL: Record<string, string> = {
    timing: 'When they want to start',
    voice: 'Answered by voice',
    all_optional: 'Answered every optional question',
    whatsapp: 'OK to WhatsApp',
    duration: 'Took a normal time (30 s – 15 min)',
  };
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">Why this ranking</h2>
        <button className="btn-secondary px-3 py-1 text-sm" disabled={rematch.isPending} onClick={() => rematch.mutate()}>
          {rematch.isPending ? 'Re-matching…' : 'Re-match now'}
        </button>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        Priority <b>{lead.priority}</b> = {pm} × best match {lead.best_match ?? 0} + {pi} × intent {lead.intent_score}
        {lead.match_detail?.profile_set_version ? ` · Profiles v${lead.match_detail.profile_set_version}` : ''}
      </p>
      {lead.never_hit.length > 0 && (
        <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Never rule hit → “Not a fit”</p>
          <ul>
            {lead.never_hit.map((n) => (
              <li key={n.label}>
                ⛔ {n.label}: {n.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 space-y-3">
        {lead.profile_matches.length === 0 && <p className="text-sm text-stone-500">No profiles were compared.</p>}
        {lead.profile_matches.map((m, i) => (
          <ProfileMatchBlock key={m.profile_id} m={m} best={i === 0} />
        ))}
      </div>
      <h3 className="mt-4 text-sm font-semibold">Intent {lead.intent_score}/100</h3>
      <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
        {Object.entries(INTENT_LABEL).map(([k, label]) => (
          <li key={k} className={ib[k] ? 'text-emerald-800' : 'text-stone-400'}>
            {ib[k] ? '✓' : '–'} {label} {ib[k] ? `+${ib[k]}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProfileMatchBlock({ m, best }: { m: ProfileMatchJson; best: boolean }) {
  return (
    <details open={best} className="rounded-xl border border-stone-200 p-3">
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">{m.name}</span> — {m.match}%{' '}
        {m.qualified ? <Badge tone="green">qualifies</Badge> : <Badge tone="amber">must-have not met</Badge>} {best && <Badge tone="blue">best</Badge>}
      </summary>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
        <div className={`h-full ${m.qualified ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, m.match)}%` }} />
      </div>
      <ul className="mt-2 space-y-0.5 text-sm">
        {m.failed_must.map((r, i) => (
          <li key={`f${i}`} className="text-red-700">
            ✗ must: {r.text}
          </li>
        ))}
        {m.matched.map((r, i) => (
          <li key={`m${i}`} className="text-emerald-800">
            ✓ {r.importance}: {r.text}
          </li>
        ))}
        {m.missed.map((r, i) => (
          <li key={`x${i}`} className="text-stone-500">
            – {r.importance}: {r.text}
          </li>
        ))}
        {m.matched.length + m.missed.length + m.failed_must.length === 0 && (
          <li className="text-stone-500">None of this profile’s questions were shown to this person.</li>
        )}
      </ul>
    </details>
  );
}

function Answers({ lead, config }: { lead: ResponseRow; config: FormConfig | null }) {
  const order = config ? config.questions.map((q) => q.key) : Object.keys(lead.answers);
  const keys = [...order.filter((k) => k in lead.answers), ...Object.keys(lead.answers).filter((k) => !order.includes(k))];
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Answers</h2>
      <dl className="mt-2 divide-y divide-stone-100">
        {keys.map((k) => {
          const a = lead.answers[k];
          const isContact = a.value && typeof a.value === 'object' && !Array.isArray(a.value);
          return (
            <div key={k} className="py-2">
              <dt className="text-xs text-stone-500">{a.question_label}</dt>
              <dd className="whitespace-pre-line text-sm">
                {isContact ? (
                  <>
                    {(a.value as ContactValue).name} · {formatPhone((a.value as ContactValue).phone)} · WhatsApp {(a.value as ContactValue).whatsapp_ok ? 'OK' : 'no'}
                  </>
                ) : (
                  a.display
                )}
                {a.voice_note_id && <Badge tone="blue">🎤 voice</Badge>}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function VoiceNotes({ lead }: { lead: ResponseRow }) {
  const notes = useQuery({
    queryKey: qk.voice(lead.id),
    queryFn: async () => must(await supabase.from('voice_notes').select('*').eq('response_id', lead.id).order('created_at')) as VoiceNoteRow[],
    refetchInterval: (q) => ((q.state.data ?? []).some((n) => !n.transcript_machine && n.status !== 'failed' && !n.audio_deleted_at) ? 15_000 : false),
  });
  if (!notes.data?.length) return null;
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Voice notes</h2>
      <div className="mt-2 space-y-4">
        {notes.data.map((n) => (
          <VoiceNote key={n.id} note={n} label={lead.answers[n.question_key]?.question_label ?? n.question_key} />
        ))}
      </div>
    </section>
  );
}

function VoiceNote({ note, label }: { note: VoiceNoteRow; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function load() {
    setErr(null);
    const { data, error } = await supabase.storage.from('voice-notes').createSignedUrl(note.storage_path, 3600);
    if (error) setErr(error.message);
    else setUrl(data.signedUrl);
  }
  const edited = note.edited_by_respondent;
  return (
    <div className="rounded-xl border border-stone-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{label}</span>
        <Badge>{Math.round(Number(note.duration_seconds))}s</Badge>
        {note.language && <Badge>{note.language}</Badge>}
        {edited && <Badge tone="amber">edited by respondent</Badge>}
        <Badge tone={note.status === 'failed' ? 'red' : 'stone'}>{note.status}</Badge>
      </div>
      {note.audio_deleted_at ? (
        <p className="mt-2 text-stone-500">Audio deleted after the retention period ({format(new Date(note.audio_deleted_at), 'd MMM yyyy')}). Transcripts are kept.</p>
      ) : url ? (
        <audio className="mt-2 w-full" controls src={url} preload="none">
          <track kind="captions" />
        </audio>
      ) : (
        <button className="btn-secondary mt-2 px-3 py-1 text-sm" onClick={load}>
          ▶ Load audio
        </button>
      )}
      {err && <p className="text-red-700">{err}</p>}
      <div className="mt-2 space-y-2">
        {note.transcript_final && (
          <p>
            <span className="text-xs text-stone-500">Sent by respondent:</span>
            <br />
            {note.transcript_final}
          </p>
        )}
        {(edited || !note.transcript_final) && (
          <p className="text-stone-600">
            <span className="text-xs text-stone-500">Machine transcript:</span>
            <br />
            {note.transcript_machine ?? (note.status === 'failed' ? 'Transcription failed.' : 'Transcribing… (checks every 15 s)')}
          </p>
        )}
        {note.transcript_en && (
          <p className="text-stone-700">
            <span className="text-xs text-stone-500">English:</span>
            <br />
            {note.transcript_en}
          </p>
        )}
        {note.last_error && note.status !== 'transcribed' && note.status !== 'submitted' && <p className="text-xs text-red-700">Last error: {note.last_error}</p>}
        {note.last_error && note.status === 'submitted' && !note.transcript_machine && (
          <p className="text-xs text-amber-700">
            Retrying (attempt {note.transcribe_attempts}): {note.last_error}
          </p>
        )}
      </div>
    </div>
  );
}

function notesKey(id: string) {
  return `sls.admin.notesDraft.${id}`;
}

function Manage({ lead }: { lead: ResponseRow }) {
  const { session } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const update = useUpdateLead();
  const [notes, setNotes] = useState<string>(() => {
    try {
      return localStorage.getItem(notesKey(lead.id)) ?? lead.notes ?? '';
    } catch {
      return lead.notes ?? '';
    }
  });
  const dirty = notes !== (lead.notes ?? '');
  const [state, setState] = useState<SaveState>('idle');
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(notesKey(lead.id), notes);
      else localStorage.removeItem(notesKey(lead.id));
    } catch {
      /* ignore */
    }
  }, [notes, dirty, lead.id]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  function saveNotes() {
    setState('saving');
    update.mutate(
      { id: lead.id, patch: { notes: notes.trim() ? notes : null } },
      { onSuccess: () => setState('saved'), onError: () => setState('error') },
    );
  }

  const log = useMutation({
    mutationFn: async (type: 'called' | 'whatsapp_sent' | 'visit') =>
      must(await supabase.from('lead_events').insert({ response_id: lead.id, property_id: lead.property_id, type, actor: session.user.id, data: {} }).select('id').single()),
    onSuccess: () => {
      toast('Logged', 'success');
      qc.invalidateQueries({ queryKey: qk.leadEvents(lead.id) });
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });

  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-semibold">Follow-up</h2>
      <div>
        <span className="label">Status</span>
        <StatusControl lead={lead} />
        {lead.pipeline_status === 'lost' && lead.lost_reason && <p className="mt-1 text-sm text-stone-600">Reason: {lead.lost_reason}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => log.mutate('called')} disabled={log.isPending}>
          Log call
        </button>
        <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => log.mutate('whatsapp_sent')} disabled={log.isPending}>
          Log WhatsApp
        </button>
        <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => log.mutate('visit')} disabled={log.isPending}>
          Log visit
        </button>
      </div>
      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          className="input min-h-28"
          maxLength={5000}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setState('idle');
          }}
        />
        <div className="mt-2 flex items-center gap-3">
          <button className="btn-primary px-3 py-1.5 text-sm" disabled={!dirty || update.isPending} onClick={saveNotes}>
            Save notes
          </button>
          {dirty && state !== 'saving' && state !== 'error' && <span className="text-xs text-amber-700">Unsaved changes (kept on this device)</span>}
          <SaveIndicator state={state} onRetry={saveNotes} />
        </div>
      </div>
    </section>
  );
}

function Timeline({ lead }: { lead: ResponseRow }) {
  const events = useQuery({
    queryKey: qk.leadEvents(lead.id),
    queryFn: async () => must(await supabase.from('lead_events').select('*').eq('response_id', lead.id).order('created_at', { ascending: false })) as LeadEventRow[],
  });
  const admins = useQuery({
    queryKey: ['admin-emails'],
    queryFn: async () => must(await supabase.from('admins').select('user_id, email')) as Pick<AdminRow, 'user_id' | 'email'>[],
  });
  const who = (id: string | null) => (id ? (admins.data?.find((a) => a.user_id === id)?.email ?? 'an admin') : 'system');
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Timeline</h2>
      {events.isLoading ? (
        <Spinner />
      ) : (
        <ol className="mt-2 space-y-2 border-l border-stone-200 pl-4 text-sm">
          {(events.data ?? []).map((e) => (
            <li key={e.id}>
              <p>{eventText(e)}</p>
              <p className="text-xs text-stone-500">
                {format(new Date(e.created_at), 'd MMM, HH:mm')} · {who(e.actor)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
