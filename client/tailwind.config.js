/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#0E4D92',
          light: '#1E5FA8',
          dark: '#093563',
        },
        accent: '#F59E0B',
      },
    },
  },
  plugins: [],
};
