/**
 * Internationalization (i18n) Module - Framework Version
 * Provides multi-language support with pluggable translations
 *
 * Usage:
 * ```javascript
 * import { I18n } from 'mapbox-ai-framework/core';
 * import { TRANSLATIONS } from './translations.js';
 *
 * const i18n = new I18n('en', TRANSLATIONS);
 * const title = i18n.t('title');
 * ```
 */

export class I18n {
  /**
   * @param {string} defaultLang - Default language code (e.g., 'en', 'ja', 'es')
   * @param {Object} translations - Translation dictionary { lang: { key: value } }
   */
  constructor(defaultLang = 'en', translations = {}) {
    this.currentLang = defaultLang;
    this.translations = translations;
  }

  /**
   * Get translation for a key with optional variable substitution
   * Supports nested keys using dot notation (e.g., 'categories.eat')
   *
   * @param {string} key - Translation key (e.g., 'title' or 'categories.eat')
   * @param {Object} vars - Optional variables to substitute (e.g., {limit: 2000})
   * @returns {string} Translated text
   *
   * Examples:
   * ```javascript
   * i18n.t('title')  // "My App"
   * i18n.t('categories.dining')  // "Restaurants"
   * i18n.t('errors.inputTooLongMessage', { limit: 2000, current: 2500 })
   *   // "Please limit your message to 2000 characters. Current length: 2500"
   * ```
   */
  t(key, vars = {}) {
    const keys = key.split('.');
    let value = this.translations[this.currentLang];

    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        console.warn(`Translation key not found: ${key} (${this.currentLang})`);
        return key;
      }
    }

    let result = value || key;

    // Replace template variables {varName} with values
    if (typeof result === 'string' && Object.keys(vars).length > 0) {
      Object.keys(vars).forEach(varName => {
        result = result.replace(new RegExp(`\\{${varName}\\}`, 'g'), vars[varName]);
      });
    }

    return result;
  }

  /**
   * Set current language
   * @param {string} lang - Language code ('en', 'ja', 'es', etc.)
   */
  setLanguage(lang) {
    if (!this.translations[lang]) {
      console.warn(`Language not supported: ${lang}`);
      return;
    }

    this.currentLang = lang;
  }

  /**
   * Toggle between two languages
   * Useful for apps with 2 languages (e.g., English/Japanese)
   * For 3+ languages, use setLanguage() instead
   *
   * @param {string} lang1 - First language (default: 'en')
   * @param {string} lang2 - Second language (default: first available lang != lang1)
   * @returns {string} New current language
   */
  toggleLanguage(lang1 = 'en', lang2 = null) {
    if (!lang2) {
      // Auto-detect second language
      const availableLangs = Object.keys(this.translations);
      lang2 = availableLangs.find(lang => lang !== lang1) || lang1;
    }

    this.currentLang = this.currentLang === lang1 ? lang2 : lang1;
    return this.currentLang;
  }

  /**
   * Get current language
   * @returns {string} Current language code
   */
  getCurrentLanguage() {
    return this.currentLang;
  }

  /**
   * Check if current language matches given code
   * @param {string} lang - Language code to check
   * @returns {boolean}
   */
  isLanguage(lang) {
    return this.currentLang === lang;
  }

  /**
   * Check if current language is Japanese
   * Convenience method for Japanese apps
   * @returns {boolean}
   */
  isJapanese() {
    return this.currentLang === 'ja';
  }

  /**
   * Check if current language is English
   * Convenience method for bilingual apps
   * @returns {boolean}
   */
  isEnglish() {
    return this.currentLang === 'en';
  }

  /**
   * Get all available languages
   * @returns {Array<string>} Array of language codes
   */
  getAvailableLanguages() {
    return Object.keys(this.translations);
  }

  /**
   * Add or update translations for a language
   * Useful for lazy-loading translations
   *
   * @param {string} lang - Language code
   * @param {Object} translations - Translation object
   */
  addTranslations(lang, translations) {
    this.translations[lang] = {
      ...this.translations[lang],
      ...translations
    };
  }
}
