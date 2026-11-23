import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { LoadGuard } from './ui';

const Capture = lazy(() => import('./Capture'));

const AddCtx = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} });

/**
 * The one add button (QA r1 F08, r2 U01). It opens a capture line over the screen you are on: Enter saves the task and
 * closes, so you never lose your place. There is no floating disc: the phone has a `+` in the top bar, and the wide layout
 * has an `Add` button at the top of the rail. Both come from <AddButton/> and open this same line.
 */
export function AddProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <AddCtx.Provider value={{ open, toggle: () => setOpen((o) => !o) }}>
      {children}
      {open && <LoadGuard quiet><Suspense fallback={null}><Capture onClose={() => setOpen(false)} /></Suspense></LoadGuard>}
    </AddCtx.Provider>
  );
}

export const useAdd = () => useContext(AddCtx);

export function AddButton({ variant }: { variant: 'bar' | 'rail' }) {
  const { open, toggle } = useContext(AddCtx);
  return (
    <button
      type="button" className={variant === 'rail' ? 'btn add-btn rail-add' : 'icon-btn add-btn bar-add'} aria-label={open ? 'Close add' : 'Add'}
      aria-expanded={open} aria-haspopup="dialog" onClick={toggle} data-testid="add"
    >
      <Plus size={variant === 'rail' ? 18 : 22} aria-hidden />{variant === 'rail' && <span>Add</span>}
    </button>
  );
}
