// Answer options for "Choose": add, edit English/Hindi inline, reorder (drag on desktop,
// arrows on phones), archive/delete through the dependency dialog, restore archived ones.
import { useState } from 'react';
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { OptionRow, QuestionRow } from '../types.ts';
import { SaveIndicator, type SaveState } from '../ui.tsx';

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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: o.id, disabled: p.isPath });
  const st = p.optionStatus(o.id);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
      className={`flex flex-wrap items-center gap-2 rounded-xl bg-white p-2 ${isDragging ? 'z-10 shadow-lg' : ''}`}
    >
      <button className="hidden cursor-grab touch-none px-1 text-stone-400 sm:block" aria-label={`Drag to reorder “${o.label_en}”`} disabled={p.isPath} {...attributes} {...listeners}>
        ⠿
      </button>
      <div className="flex flex-col sm:hidden">
        <button className="px-1 text-xs text-stone-500 disabled:opacity-30" disabled={i === 0 || p.isPath} onClick={() => p.onReorder(moveId(ids, o.id, -1))} aria-label={`Move ${o.label_en} up`}>
          ▲
        </button>
        <button className="px-1 text-xs text-stone-500 disabled:opacity-30" disabled={i === count - 1 || p.isPath} onClick={() => p.onReorder(moveId(ids, o.id, 1))} aria-label={`Move ${o.label_en} down`}>
          ▼
        </button>
      </div>
      <input aria-label={`Option ${i + 1} (English)`} className="input min-w-0 flex-1 py-1.5" maxLength={200} value={o.label_en} onChange={(e) => p.onPatch(o, { label_en: e.target.value })} />
      <input aria-label={`Option ${i + 1} (Hindi)`} className="input min-w-0 flex-1 py-1.5" maxLength={200} placeholder="हिंदी" value={o.label_hi ?? ''} onChange={(e) => p.onPatch(o, { label_hi: e.target.value || null })} />
      <code className="text-xs text-stone-500" title={o.first_published_at ? 'Locked: published' : 'Internal value'}>
        {o.value}
        {o.first_published_at ? ' 🔒' : ''}
      </code>
      <SaveIndicator state={st.state} error={st.error} onRetry={p.onRetry} />
      {!p.isPath && (
        <button className="btn-ghost px-2 py-1 text-sm text-red-700" onClick={() => p.onRemove(o)}>
          {o.first_published_at ? 'Archive' : 'Delete'}
        </button>
      )}
    </li>
  );
}

export function OptionsEditor(p: OptionsEditorProps) {
  const [newOpt, setNewOpt] = useState('');
  const active = p.q.question_options.filter((o) => !o.archived_at).sort((a, b) => a.position - b.position);
  const archived = p.q.question_options.filter((o) => o.archived_at);
  const ids = active.map((o) => o.id);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    p.onReorder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };
  return (
    <section className="card p-4">
      <h4 className="label">Answer options</h4>
      {p.isPath && <p className="mb-2 text-xs text-stone-500">These three answers decide which questions follow. You can change the wording only.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2 rounded-xl bg-stone-50 p-1">
            {active.map((o, i) => (
              <Row key={o.id} o={o} i={i} count={active.length} ids={ids} p={p} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {!p.isPath && (
        <form
          className="mt-2 flex gap-2"
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
          <input id={`newopt-${p.q.id}`} className="input py-1.5" placeholder="Add an option…" maxLength={200} value={newOpt} onChange={(e) => setNewOpt(e.target.value)} />
          <button className="btn-secondary px-3 py-1.5" disabled={!newOpt.trim()}>
            Add
          </button>
        </form>
      )}
      {archived.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-stone-500">Archived options ({archived.length})</summary>
          <ul className="mt-1 space-y-1">
            {archived.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <span className="text-stone-500 line-through">{o.label_en}</span>
                <button className="text-xs underline" onClick={() => p.onRestore(o)}>
                  restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
