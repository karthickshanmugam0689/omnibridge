/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        surface: "hsl(var(--surface))",
        ink: "hsl(var(--ink))",
        success: "hsl(var(--success))",
        offline: "hsl(var(--offline))",
        border: "hsl(var(--border))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
      },
      fontFamily: {
        sans: ['"Atkinson Hyperlegible"', "system-ui", "sans-serif"],
      },
      fontSize: {
        base: ["18px", { lineHeight: "1.6" }],
      },
      borderRadius: {
        "2xl": "1.25rem",
      },
      boxShadow: {
        soft: "0 4px 16px -2px rgba(26, 26, 26, 0.08), 0 2px 6px -1px rgba(26, 26, 26, 0.04)",
        "soft-lg": "0 8px 28px -4px rgba(26, 26, 26, 0.12), 0 4px 10px -2px rgba(26, 26, 26, 0.06)",
      },
      minHeight: {
        touch: "56px",
      },
      minWidth: {
        touch: "56px",
      },
    },
  },
  plugins: [],
};
