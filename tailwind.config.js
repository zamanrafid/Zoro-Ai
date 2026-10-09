/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1120",
        panel: "#111827",
        accent: "#3B82F6",
        accent2: "#8B5CF6",
        paper: "#F8FAFC",
        muted: "#94A3B8"
      }
    }
  },
  plugins: []
};
