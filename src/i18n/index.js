import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

const LANGUAGE_STORAGE_KEY = 'txstudio_language';

function getInitialLanguage() {
    try {
        const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (savedLanguage === 'zh' || savedLanguage === 'en') return savedLanguage;
    } catch {
        // 在无法访问本地存储的环境中继续使用浏览器语言。
    }
    return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

const resources = {
    zh: { translation: {} },
    en: { translation: en },
};

i18n
    .use(initReactI18next)
    .init({
        resources,
        lng: getInitialLanguage(),
        fallbackLng: 'zh',
        nsSeparator: false,
        keySeparator: false,
        interpolation: { escapeValue: false },
        returnEmptyString: false,
    });

export { LANGUAGE_STORAGE_KEY };

export default i18n;
