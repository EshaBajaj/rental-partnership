import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { AdminRow, PropertyRow } from './types.ts';

export interface AdminCtx {
  session: Session;
  me: AdminRow;
  property: PropertyRow;
  properties: PropertyRow[];
  setPropertyId: (id: string) => void;
}

export const Ctx = createContext<AdminCtx | null>(null);

export function useAdmin(): AdminCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAdmin outside AdminApp');
  return c;
}
