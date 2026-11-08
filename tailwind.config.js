// Tailwind v3 config used to build tailwind.css (see README "Development").
module.exports = {
  content: ['./index.html', './app.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        serif: ['"Crimson Pro"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        paper: '#FAF8F5',
        surface: '#FFFFFF',
        subtle: '#F3EFEA',
        ink: '#18181B',
        muted: '#52525B',
        cobalt: '#1D4ED8',
        terracotta: '#C2410C',
        // Keep the full shade scale so utilities like bg-emerald-50 / text-emerald-400 still resolve
        emerald: {
          DEFAULT: '#15803D',
          50: '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7', 400: '#34D399',
          500: '#10B981', 600: '#059669', 700: '#047857', 800: '#065F46', 900: '#064E3B', 950: '#022C22'
        },
        borderWarm: '#E4E2DD'
      }
    }
  }
};
