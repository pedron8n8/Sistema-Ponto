/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'Space Grotesk', 'sans-serif'],
        display: ['Space Grotesk', 'IBM Plex Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
