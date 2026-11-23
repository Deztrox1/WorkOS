import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check as CheckIcon, X } from 'lucide-react';
import { dismissToast, useToasts } from '../lib/toast';
import type { Slice } from '../lib/store';
import type { Severity } from '../lib/types';

export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className="check" disabled={disabled} onClick={() => onChange(!checked)}>
      <span>{checked && <CheckIcon size={14} aria-hidden strokeWidth={3} />}</span>
    </button>
  );
}

/**
 * A screen loads on demand, so its file can fail to arrive (offline and never fetched, or a new release replaced it). Without
 * this the whole app goes blank.
 */
export class LoadGuard extends Component<{ children: ReactNode; quiet?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="empty" data-testid="screen-failed">
        <p>This screen did not open. Check your connection, then try again.</p>
        <button type="button" className="btn" onClick={() => location.reload()}>Try again</button>
      </div>
    );
  }
}

export function SeverityDot({ severity }: { severity: Severity }) {
  return <span className={`dot ${severity}`} role="img" aria-label={severity} title={severity} />;
}

export function Chip({ children, tone }: { children: ReactNode; tone?: 'warn' | 'bad' | 'good' }) {
  return <span className={`chip ${tone ?? ''}`}>{children}</span>;
}

export function Segmented<T extends string>({
  value, options, onChange, label, paper,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; paper?: boolean }) {
  return (
    <div className={`seg ${paper ? 'paper' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The four list states: loading (three grey rows), error (Could not load. + Retry), empty, content. */
export function ListState({
  slices, empty, emptyText, onRetry, children,
}: { slices: Slice<unknown>[]; empty: boolean; emptyText: string; onRetry: () => void; children: ReactNode }) {
  const failed = slices.some((s) => s.status === 'error');
  const loading = slices.some((s) => s.status === 'loading' || s.status === 'idle');
  if (failed) {
    return (
      <div className="errbox" role="alert">
        <span>Could not load.</span>
        <button type="button" className="btn" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="state-rows" aria-busy="true" aria-label="Loading" data-testid="loading-rows">
        <div className="ph" /><div className="ph" /><div className="ph" />
      </div>
    );
  }
  if (empty) return <p className="empty">{emptyText}</p>;
  return <>{children}</>;
}

/** A side or bottom panel. `quick` is the small capture panel over the current screen. */
export function Sheet({ title, onClose, children, footer, variant }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; variant?: 'quick' }) {
  const ref = useRef<HTMLDivElement>(null);
  // Escape must close with what is on the form now: the listener below is set once, so a captured onClose saves the first render.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    document.body.classList.add('sheet-open');
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      // A confirm dialog opened over the sheet owns the keyboard.
      if (document.querySelector('[role="alertdialog"]')) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (els.length === 0) return;
      const first = els[0], last = els[els.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && ref.current.contains(active);
      if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const opener = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input, textarea, select, button'))?.focus();
    return () => {
      document.body.classList.remove('sheet-open');
      document.removeEventListener('keydown', onKey);
      // The opener can be gone (a menu item that closed): fall back to the add button, never to <body> (QA r1 U22).
      const back = opener && opener.isConnected && opener !== document.body ? opener : document.querySelector<HTMLElement>('[data-testid="add"]');
      back?.focus();
    };
  }, []);
  return createPortal(
    <>
      <div className="backdrop" onClick={onClose} aria-hidden />
      <div className={`sheet ${variant ?? ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} data-testid="sheet">
        <div className="handle" aria-hidden />
        <div className="sheet-h">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={20} aria-hidden /></button>
        </div>
        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export function Confirm({ text, confirmLabel = 'Delete', onConfirm, onCancel }: { text: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  return createPortal(
    <div className="dialog-back" role="presentation">
      <div className="dialog" role="alertdialog" aria-label="Confirm" aria-modal="true">
        <p>{text}</p>
        <div className="acts">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Toasts() {
  const items = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.action && (
            <button type="button" className="toast-act" onClick={() => { dismissToast(t.id); t.action!.run(); }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{label}{children}</label>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export const isTime24 = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** 24 hour time as plain text, so it never shows AM/PM whatever the device locale is. */
export function Time24({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} pattern="([01][0-9]|2[0-3]):[0-5][0-9]" value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** Text input that saves on blur only when changed. */
export function BlurInput({
  value, onSave, placeholder, label, className, multiline, disabled,
}: { value: string; onSave: (v: string) => void; placeholder?: string; label: string; className?: string; multiline?: boolean; disabled?: boolean }) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setV(value); }, [value]);
  const commit = () => {
    if (dirty.current && v !== value) onSave(v);
    dirty.current = false;
  };
  const common = {
    value: v, placeholder, disabled, 'aria-label': label,
    onChange: (e: { target: { value: string } }) => { dirty.current = true; setV(e.target.value); },
    onBlur: commit,
  };
  return multiline ? <textarea className={className ?? 'input'} {...common} /> : <input className={className ?? 'input'} {...common} />;
}

export function Spark({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null;
  const w = 160, h = 36, pad = 3;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => [pad + (i * (w - 2 * pad)) / (points.length - 1), h - pad - ((p - min) / span) * (h - 2 * pad)] as const);
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} data-testid="spark" data-points={points.length}>
      <polyline fill="none" stroke="var(--acc)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={xy.map(([x, y]) => `${x},${y}`).join(' ')} />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="3" fill="var(--acc)" />
    </svg>
  );
}
