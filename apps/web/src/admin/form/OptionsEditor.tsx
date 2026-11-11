// Answer options for "Choose": add, edit English/Hindi inline, reorder (press and hold a row
// and drag, or the up/down buttons), archive/delete through the dependency dialog, restore archived ones.
import { useState } from 'react';
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Icon } from '../../lib/icons.tsx';
import { buzzOnPickUp, liftedClass, useHoldToReorderSensors } from '../sortable.ts';
import type { OptionRow, QuestionRow } from '../types.ts';
import { SaveIndicator, type SaveState } from '../ui.tsx';
import { ReorderHint, rowListeners } from './reorder.tsx';

type Status = { state: SaveState; error: string | null };

export interface OptionsEditorProps {
  q: QuestionRow;
  isPath: boolean;
  optionStatus: (id: string) => Status;
  onRetry: () => void;
  onPatch: (o: OptionRow, patch: Partial<OptionRow>) => void;
  onAdd: (label: string) => void;
  onReorder: (ids: string[]) => void;
  onRemove: (o: OptionRow) => void;
  onRestore: (o: OptionRow) => void;
}

/** New order after moving one option up/down (pure, tested). */
export function moveId(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  if (i < 0 || i + dir < 0 || i + dir >= ids.length) return ids;
  return arrayMove(ids, i, i + dir);
}

function Row({ o, i, count, ids, p }: { o: OptionRow; i: number; count: number; ids: string[]; p: OptionsEditorProps }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: o.id, disabled: p.isPath });
  const st = p.optionStatus(o.id);
  const name = o.label_en || `option ${i + 1}`;
  return (
    // Hold anywhere on the row (outside the text boxes) to drag it.
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
      className={`flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white p-2 ${p.isPath ? '' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? liftedClass : ''}`}
      {...rowListeners(listeners)}
    >
      {!p.isPath && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="btn-ghost btn-icon btn-sm text-stone-400"
          title="Hold to drag"
          {...attributes}
          aria-label={`Reorder “${name}”: hold to drag, or press Space and use the arrow keys`}
        >
          <Icon name="drag" />
        </button>
      )}
      <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
        <input aria-label={`Option ${i + 1} (English)`} className="input min-w-0" maxLength={200} value={o.label_en} onChange={(e) => p.onPatch(o, { label_en: e.target.value })} />
        <input aria-label={`Option ${i + 1} (Hindi)`} className="input min-w-0" maxLength={200} placeholder="हिंदी" value={o.label_hi ?? ''} onChange={(e) => p.onPatch(o, { label_hi: e.target.value || null })} />
      </div>
      {!p.isPath && (
        <div className="flex flex-col">
          <button type="button" data-no-drag className="btn-ghost btn-icon btn-sm text-stone-500" disabled={i === 0} onClick={() => p.onReorder(moveId(ids, o.id, -1))} aria-label={`Move “${name}” up`}>
            <Icon name="up" />
          </button>
          <button type="button" data-no-drag className="btn-ghost btn-icon btn-sm text-stone-500" disabled={i === count - 1} onClick={() => p.onReorder(moveId(ids, o.id, 1))} aria-label={`Move “${name}” down`}>
            <Icon name="down" />
          </button>
        </div>
      )}
      <div className={`flex w-full flex-wrap items-center gap-2 ${p.isPath ? '' : 'pl-12'}`}>
        <code className="inline-flex min-w-0 items-center gap-1 break-all text-xs text-stone-500" title={o.first_published_at ? 'Locked: published' : 'Internal value'}>
          {o.value}
          {o.first_published_at && <Icon name="lock" size={12} label="Locked: published" />}
        </code>
        <SaveIndicator state={st.state} error={st.error} onRetry={p.onRetry} />
        {!p.isPath && (
          <button type="button" data-no-drag className="btn-ghost btn-sm ml-auto text-red-700 hover:bg-red-50" onClick={() => p.onRemove(o)}>
            <Icon name="delete" size={16} />
            {o.first_published_at ? 'Archive' : 'Delete'}
          </button>
        )}
      </div>
    </li>
  );
}

export function OptionsEditor(p: OptionsEditorProps) {
  const [newOpt, setNewOpt] = useState('');
  const active = p.q.question_options.filter((o) => !o.archived_at).sort((a, b) => a.position - b.position);
  const archived = p.q.question_options.filter((o) => o.archived_at);
  const ids = active.map((o) => o.id);
  const sensors = useHoldToReorderSensors();
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    p.onReorder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };
  return (
    <section className="card p-3 sm:p-4">
      <h4 className="label">Answer options</h4>
      {p.isPath ? (
        <p className="mb-2 text-xs text-stone-500">These three answers decide which questions follow. You can change the wording only.</p>
      ) : (
        active.length > 1 && <ReorderHint className="mb-2" />
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={buzzOnPickUp} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {active.map((o, i) => (
              <Row key={o.id} o={o} i={i} count={active.length} ids={ids} p={p} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {!p.isPath && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newOpt.trim()) {
              p.onAdd(newOpt.trim());
              setNewOpt('');
            }
          }}
        >
          <label className="sr-only" htmlFor={`newopt-${p.q.id}`}>
            New option
          </label>
          <input id={`newopt-${p.q.id}`} className="input min-w-0 flex-1" placeholder="Add an option…" maxLength={200} value={newOpt} onChange={(e) => setNewOpt(e.target.value)} />
          <button className="btn-secondary" disabled={!newOpt.trim()}>
            <Icon name="add" />
            Add
          </button>
        </form>
      )}
      {archived.length > 0 && (
        <details className="group mt-3 text-sm">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-stone-600 [&::-webkit-details-marker]:hidden">
            <Icon name="down" size={16} className="-rotate-90 transition-transform group-open:rotate-0" />
            Archived options ({archived.length})
          </summary>
          <ul className="mt-1 space-y-1">
            {archived.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 break-words text-stone-500 line-through">{o.label_en}</span>
                <button type="button" className="btn-ghost btn-sm" onClick={() => p.onRestore(o)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
