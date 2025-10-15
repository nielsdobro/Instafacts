/** @type {import('tailwindcss').Config} */
export default {
  // Include root-level files because this project keeps App.tsx at the root
  content: [
    "./index.html",
    "./**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
