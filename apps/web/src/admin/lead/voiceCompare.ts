// Compare the three versions of a spoken answer (pure, tested):
//   live (browser, while speaking) · Whisper (machine, after upload) · sent (what the respondent submitted).
import type { VoiceNoteRow } from '../types.ts';

export type VersionKey = 'live' | 'whisper' | 'sent';
export interface Version {
  key: VersionKey;
  label: string;
  text: string | null;
  /** why there is no text */
  missing?: string;
}

export function voiceVersions(n: Pick<VoiceNoteRow, 'transcript_live' | 'transcript_machine' | 'transcript_final' | 'status' | 'storage_path' | 'audio_missing'>): Version[] {
  const noAudio = n.audio_missing || !n.storage_path;
  return [
    { key: 'live', label: 'Live transcript (browser)', text: n.transcript_live, missing: n.transcript_live ? undefined : 'Not available (browser could not transcribe live, or live transcript is off)' },
    {
      key: 'whisper',
      label: 'Whisper (from the recording)',
      text: n.transcript_machine,
      missing: n.transcript_machine ? undefined : noAudio ? 'No recording to transcribe' : n.status === 'failed' ? 'Transcription failed' : 'Transcribing…',
    },
    { key: 'sent', label: 'Sent by respondent', text: n.transcript_final, missing: n.transcript_final ? undefined : 'Nothing typed — the transcript is used' },
  ];
}

/** The text to show first: what was sent, else Whisper, else live. */
export function primaryText(n: Pick<VoiceNoteRow, 'transcript_live' | 'transcript_machine' | 'transcript_final'>): string | null {
  return n.transcript_final || n.transcript_machine || n.transcript_live || null;
}

export interface DiffPart {
  text: string;
  kind: 'same' | 'added' | 'removed';
}

/** Word-level diff (LCS) of `from` → `to`, for highlighting what changed. */
export function wordDiff(from: string, to: string): DiffPart[] {
  const a = from.split(/\s+/).filter(Boolean);
  const b = to.split(/\s+/).filter(Boolean);
  if (a.length * b.length > 250_000) return [{ text: to, kind: 'same' }]; // too long to diff cheaply
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (text: string, kind: DiffPart['kind']) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += ` ${text}`;
    else out.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i], 'same');
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push(a[i++], 'removed');
    else push(b[j++], 'added');
  }
  while (i < a.length) push(a[i++], 'removed');
  while (j < b.length) push(b[j++], 'added');
  return out;
}
