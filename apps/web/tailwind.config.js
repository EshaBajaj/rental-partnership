/** @type {import('tailwindcss').Config} */
// One palette for the whole app: trust navy (brand) on cool slate neutrals, with muted status colours.
// `stone` is remapped to the slate neutrals so every existing neutral class follows the same scheme.
// Respondent pages read the CSS variables in src/index.css, which use these same values.
const brand = {
  50: '#EFF4FB',
  100: '#DCE7F6',
  200: '#B9CEEC',
  300: '#8FB0DF',
  400: '#5E8BCD',
  500: '#3A6BB8',
  600: '#2A559C',
  700: '#1F4580',
  800: '#183766',
  900: '#122A4E',
};
const neutral = {
  50: '#F7F9FB',
  100: '#EEF2F6',
  200: '#E1E7EE',
  300: '#CBD3DD',
  400: '#9AA6B5',
  500: '#6B7787',
  600: '#4F5B6B',
  700: '#3A4553',
  800: '#27303B',
  900: '#161D26',
};
const success = { 50: '#ECF7F1', 100: '#D3EEDF', 200: '#B1E0C6', 300: '#8FD0AE', 400: '#5DB58A', 500: '#2F9467', 600: '#237A54', 700: '#1C6545', 800: '#164F37', 900: '#103B29' };
const warning = { 50: '#FFF7E8', 100: '#FDEBC8', 200: '#F9D99A', 300: '#F4C66E', 400: '#E9A93A', 500: '#D4902A', 600: '#B7791F', 700: '#94600F', 800: '#744A0B', 900: '#573708' };
const danger = { 50: '#FDF0EF', 100: '#FADBD8', 200: '#F3B9B3', 300: '#EA968D', 400: '#DD6B5F', 500: '#C9402F', 600: '#B42318', 700: '#962016', 800: '#7A1B13', 900: '#5E150F' };

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens (see src/index.css)
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        ink: 'var(--text)',
        muted: 'var(--muted)',
        primary: 'var(--primary)',
        'primary-ink': 'var(--primary-ink)',
        'primary-soft': 'var(--primary-soft)',
        line: 'var(--border)',
        success: 'var(--success)',
        danger: 'var(--error)',
        brand,
        stone: neutral,
        slate: neutral,
        emerald: success,
        green: success,
        amber: warning,
        yellow: warning,
        red: danger,
        sky: brand,
        blue: brand,
        violet: { 100: '#ECE9F8', 800: '#43358A' },
      },
      borderRadius: { xl: '12px', '2xl': '14px' },
      fontFamily: { sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans', 'Noto Sans Devanagari', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(22,29,38,.04), 0 1px 3px rgba(22,29,38,.06)' },
    },
  },
  plugins: [],
};
