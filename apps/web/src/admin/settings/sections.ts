// Settings sub-pages, shared by the sidebar and the Settings screen (kept apart so the sidebar doesn't load the QR library).
import type { IconName } from '../../lib/icons.tsx';

export const SETTINGS_SECTIONS: readonly { slug: string; label: string; icon: IconName; hint: string }[] = [
  { slug: 'property', label: 'Property', icon: 'store', hint: 'Name, language, open or close the form' },
  { slug: 'brand', label: 'Brand & trust', icon: 'brand', hint: 'What respondents see about you' },
  { slug: 'qr', label: 'QR poster', icon: 'qr', hint: 'Download or print the QR code' },
  { slug: 'account', label: 'My account', icon: 'key', hint: 'Change your password' },
];
