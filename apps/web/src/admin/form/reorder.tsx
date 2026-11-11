// Hold-to-reorder bits shared by the question list, the option list and the profiles list.
// The whole row listens for a press-and-hold (see ../sortable.ts); presses that start inside a
// text field or select are left alone so typing, selecting text and opening pickers still work.
import type { DraggableSyntheticListeners } from '@dnd-kit/core';
import type { SyntheticEvent } from 'react';
import { Icon } from '../../lib/icons.tsx';

const CONTROL = 'input, textarea, select, [contenteditable="true"], [data-no-drag]';

function startsInControl(e: SyntheticEvent): boolean {
  const t = e.target as Element | null;
  return !!t && typeof t.closest === 'function' && !!t.closest(CONTROL);
}

/** Row-level drag listeners that ignore presses starting in form controls. Keyboard dragging stays on the grip (activator node). */
export function rowListeners(listeners: DraggableSyntheticListeners): Record<string, (e: SyntheticEvent) => void> | undefined {
  if (!listeners) return undefined;
  const out: Record<string, (e: SyntheticEvent) => void> = {};
  for (const [name, fn] of Object.entries(listeners)) {
    out[name] = (e) => {
      if (name !== 'onKeyDown' && startsInControl(e)) return;
      (fn as (ev: SyntheticEvent) => void)(e);
    };
  }
  return out;
}

/** One-line hint shown above each sortable list. */
export function ReorderHint({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs text-stone-500 ${className}`}>
      <Icon name="drag" size={14} />
      Hold a row and drag to reorder
    </p>
  );
}
