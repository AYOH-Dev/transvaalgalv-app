/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx,html}'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6'
      }
    }
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        transvaal: {
          primary: '#0ea5e9',
          'primary-focus': '#0284c7',
          secondary: '#06b6d4',
          accent: '#7c3aed',
          neutral: '#111827',
          'base-100': '#ffffff'
        }
      }
    ]
  }
}
