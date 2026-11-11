export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
export const FUNCTIONS_URL = (import.meta.env.VITE_FUNCTIONS_URL || `${SUPABASE_URL}/functions/v1`).replace(/\/$/, '');
export const DEFAULT_SLUG = import.meta.env.VITE_DEFAULT_SLUG ?? 'main-road-shop';
