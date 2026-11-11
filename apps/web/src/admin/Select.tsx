// Clean dropdown used instead of the browser's <select> for in-row choices (status, etc.).
// The menu is position:fixed so tables with overflow-x scroll don't clip it; it flips up near the bottom of the screen.
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../lib/icons.tsx';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Tailwind bg-* class for a small colour dot. */
  dot?: string;
  hint?: string;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  size = 'md',
  variant = 'field',
  className = '',
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (v: T) => void;
  /** accessible name */
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** field = looks like an input; pill = soft tinted chip for table cells */
  variant?: 'field' | 'pill';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = Math.min(options.length * 40 + 12, 320);
    const up = r.bottom + menuH + 8 > window.innerHeight && r.top > menuH + 8;
    setPos({ top: up ? r.top - menuH - 4 : r.bottom + 4, left: Math.min(r.left, window.innerWidth - Math.max(r.width, 200) - 8), width: Math.max(r.width, 200), up });
  }, [options.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const close = (e: Event) => {
      if (e.type === 'scroll' && menu.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const outside = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    document.addEventListener('mousedown', outside);
    requestAnimationFrame(() => menu.current?.focus());
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('mousedown', outside);
    };
  }, [open, options, value]);

  function choose(v: T) {
    setOpen(false);
    btn.current?.focus();
    if (v !== value) onChange(v);
  }

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % options.length);
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + options.length) % options.length);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(options.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') choose(options[active].value);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      if (e.key === 'Escape') btn.current?.focus();
      return;
    } else return;
    e.preventDefault();
  }

  const h = size === 'sm' ? 'h-9 text-sm' : 'h-10 text-sm';
  const look =
    variant === 'pill'
      ? 'rounded-full bg-stone-100 px-3 font-medium text-stone-800 hover:bg-stone-200'
      : 'rounded-xl border border-stone-300 bg-white px-3 text-stone-800 hover:border-stone-400';

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`inline-flex items-center gap-2 outline-none transition focus-visible:ring-2 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 ${h} ${look} ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`${label}: ${current?.label ?? ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {current?.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${current.dot}`} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-left">{current?.label}</span>
        <Icon name="down" size={16} className={`text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && (
        <ul
          ref={menu}
          id={id}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onMenuKey}
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
          className="fixed z-50 max-h-80 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 shadow-lg outline-none"
        >
          {options.map((o, i) => (
            <Option key={o.value} id={`${id}-${i}`} selected={o.value === value} active={i === active} onHover={() => setActive(i)} onPick={() => choose(o.value)}>
              {o.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${o.dot}`} aria-hidden="true" />}
              <span className="flex-1">
                {o.label}
                {o.hint && <span className="block text-xs text-stone-500">{o.hint}</span>}
              </span>
            </Option>
          ))}
        </ul>
      )}
    </>
  );
}

function Option({ id, selected, active, onHover, onPick, children }: { id: string; selected: boolean; active: boolean; onHover: () => void; onPick: () => void; children: ReactNode }) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      onMouseEnter={onHover}
      onClick={onPick}
      className={`flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 text-sm ${active ? 'bg-stone-100' : ''} ${selected ? 'font-medium text-brand-800' : 'text-stone-700'}`}
    >
      {children}
      <Icon name="tick" size={16} className={selected ? 'text-brand-700' : 'invisible'} />
    </li>
  );
}
