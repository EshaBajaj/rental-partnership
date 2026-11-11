/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Design tokens (see src/index.css): one calm accent, warm neutral background.
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
        // legacy scale used by the admin, mapped onto the same accent
        brand: { 50: '#F1F6F7', 100: '#E6EFF1', 500: '#2E7487', 600: '#25667A', 700: '#1E5A6B', 800: '#174855' },
      },
      borderRadius: { xl: '12px', '2xl': '12px' },
      fontFamily: { sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans', 'Noto Sans Devanagari', 'sans-serif'] },
    },
  },
  plugins: [],
};
