/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                script: ['"Dancing Script"', 'cursive'],
            },
            colors: {
                // 品牌主色：靛蓝 → 紫罗兰渐变体系
                brand: {
                    50: '#eef2ff',
                    100: '#e0e7ff',
                    200: '#c7d2fe',
                    300: '#a5b4fc',
                    400: '#818cf8',
                    500: '#6366f1',
                    600: '#4f46e5',
                    700: '#4338ca',
                    800: '#3730a3',
                    900: '#312e81',
                },
            },
            boxShadow: {
                'glow': '0 0 0 1px rgba(99,102,241,0.25), 0 8px 30px -8px rgba(99,102,241,0.45)',
                'glow-lg': '0 0 0 1px rgba(99,102,241,0.3), 0 20px 60px -12px rgba(99,102,241,0.5)',
                'card': '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.5)',
            },
            backgroundImage: {
                'brand-gradient': 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
            },
            keyframes: {
                'fade-in': {
                    '0%': { opacity: '0', transform: 'translateY(8px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'shimmer': {
                    '100%': { transform: 'translateX(100%)' },
                },
            },
            animation: {
                'fade-in': 'fade-in 0.4s ease-out both',
                'shimmer': 'shimmer 1.5s infinite',
            },
        },
    },
    plugins: [],
}
