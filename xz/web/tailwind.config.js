/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0d1117',
          secondary: '#161b22',
          tertiary: '#21262d',
        },
        text: {
          primary: '#e6edf3',
          secondary: '#7d8590',
        },
        accent: {
          cyan: '#58a6ff',
          green: '#3fb950',
          yellow: '#d29922',
          red: '#f85149',
        },
        border: '#30363d',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
}
