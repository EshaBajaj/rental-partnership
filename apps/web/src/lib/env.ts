const RAW_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
/** 'same-origin' is only used by the local demo (scripts/demo.sh), where one port serves app + API. */
export const SUPABASE_URL = (RAW_URL === 'same-origin' && typeof window !== 'undefined' ? window.location.origin : RAW_URL).replace(/\/$/, '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
export const FUNCTIONS_URL = (import.meta.env.VITE_FUNCTIONS_URL || `${SUPABASE_URL}/functions/v1`).replace(/\/$/, '');
export const DEFAULT_SLUG = import.meta.env.VITE_DEFAULT_SLUG ?? 'main-road-shop';
