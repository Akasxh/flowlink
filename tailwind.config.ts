import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        teal: {
          900: "#063a3a",
          800: "#0a4f4f",
          700: "#0c6363",
          600: "#0d7a7a",
          500: "#158b8b",
          400: "#1da0a0",
        },
        green: {
          600: "#217a49",
          500: "#2a9056",
          400: "#3ba867",
        },
        ink: {
          900: "#0f1b22",
          700: "#1a2733",
          500: "#4a5a66",
          400: "#6b7a85",
        },
        mint: {
          50: "#eef7f2",
          100: "#e3f1ea",
          200: "#cfe7db",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
