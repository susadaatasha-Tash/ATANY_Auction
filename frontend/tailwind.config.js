/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#14301f",
        "navy-2": "#1e4530",
        gold: "#c7a66a",
        cream: "#faf9f6",
        ivory: "#fffefa"
      },
      fontFamily: { jakarta: ['"Plus Jakarta Sans"', 'sans-serif'] }
    }
  },
  plugins: []
};
