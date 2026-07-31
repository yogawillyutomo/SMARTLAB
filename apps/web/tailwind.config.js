/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        base: {
          900: 'rgb(var(--color-base-900) / <alpha-value>)',
          800: 'rgb(var(--color-base-800) / <alpha-value>)',
          700: 'rgb(var(--color-base-700) / <alpha-value>)',
          600: 'rgb(var(--color-base-600) / <alpha-value>)',
        },
        accent: {
          blue: 'rgb(var(--color-accent-primary) / <alpha-value>)',
          cyan: 'rgb(var(--color-accent-secondary) / <alpha-value>)',
          primary: 'rgb(var(--color-accent-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-accent-secondary) / <alpha-value>)',
          foreground: 'rgb(var(--color-accent-foreground) / <alpha-value>)',
          content: 'rgb(var(--color-accent-content) / <alpha-value>)',
        },
        brand: {
          blue: 'rgb(var(--color-brand-blue) / <alpha-value>)',
          cyan: 'rgb(var(--color-brand-cyan) / <alpha-value>)',
        },
        info: 'rgb(var(--color-info) / <alpha-value>)',
        'status-cyan': 'rgb(var(--color-status-cyan) / <alpha-value>)',
        palette: {
          blue: 'rgb(37 99 235 / <alpha-value>)',
          cyan: 'rgb(14 116 144 / <alpha-value>)',
          indigo: 'rgb(79 70 229 / <alpha-value>)',
          violet: 'rgb(124 58 237 / <alpha-value>)',
        },
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        orange: 'rgb(var(--color-orange) / <alpha-value>)',
        purple: 'rgb(var(--color-purple) / <alpha-value>)',
        overlay: 'rgb(var(--color-overlay) / <alpha-value>)',
        ink: {
          primary: 'rgb(var(--color-ink-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-ink-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-ink-muted) / <alpha-value>)',
        },
        focus: 'rgb(var(--color-focus) / <alpha-value>)',
        'success-foreground': 'rgb(var(--color-success-foreground) / <alpha-value>)',
        'warning-foreground': 'rgb(var(--color-warning-foreground) / <alpha-value>)',
        'danger-foreground': 'rgb(var(--color-danger-foreground) / <alpha-value>)',
        'orange-foreground': 'rgb(var(--color-orange-foreground) / <alpha-value>)',
        'purple-foreground': 'rgb(var(--color-purple-foreground) / <alpha-value>)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        card: 'var(--shadow-card)',
        elevated: 'var(--shadow-elevated)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
