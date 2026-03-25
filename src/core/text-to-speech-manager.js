/**
 * TextToSpeechManager - Handle browser text-to-speech
 *
 * Uses Web Speech API (SpeechSynthesis) for cross-platform TTS
 * Supports:
 * - Auto-speak mode (automatically speaks all AI responses)
 * - Per-message playback (speaker icons on messages)
 * - Multi-language support (Japanese, English, etc.)
 * - Pause/resume/stop controls
 * - Voice selection
 */

import { errorLogger } from './error-logger.js';

export class TextToSpeechManager {
  constructor(config, i18n, lambdaUrl) {
    this.config = config;
    this.i18n = i18n;
    this.lambdaUrl = lambdaUrl;

    // Determine which TTS method to use
    this.useGoogleCloudTTS = config.TTS_USE_GOOGLE_CLOUD || false;

    // Web Speech API
    this.synthesis = window.speechSynthesis;
    this.isSupported = !!this.synthesis || this.useGoogleCloudTTS;

    // State
    this.isSpeaking = false;
    this.isPaused = false;
    this.autoSpeakEnabled = config.TTS_AUTO_SPEAK || false;
    this.currentUtterance = null;

    // Voice selection (for Web Speech API)
    this.voices = [];
    this.selectedVoice = null;

    // Audio playback (for Google Cloud TTS)
    this.audioElement = null;
    this.currentAudioUrl = null;

    // Callbacks
    this.onStartCallback = null;
    this.onEndCallback = null;
    this.onErrorCallback = null;

    // Initialize voices for Web Speech API
    if (!this.useGoogleCloudTTS && this.synthesis) {
      this.loadVoices();
    }
  }

  /**
   * Load available voices
   * Note: voices may not be immediately available on page load
   */
  loadVoices() {
    // Get voices
    this.voices = this.synthesis.getVoices();

    // If voices aren't loaded yet, wait for the event
    if (this.voices.length === 0) {
      this.synthesis.addEventListener('voiceschanged', () => {
        this.voices = this.synthesis.getVoices();
        this.selectDefaultVoice();
      });
    } else {
      this.selectDefaultVoice();
    }
  }

  /**
   * Select default voice based on current language
   */
  selectDefaultVoice() {
    if (!this.voices || this.voices.length === 0) {
      return;
    }

    const currentLang = this.i18n.getCurrentLanguage();
    const langCode = currentLang === 'ja' ? 'ja-JP' : 'en-US';

    // Find best matching voice
    // Priority: 1. Exact lang match + local, 2. Exact lang match, 3. Partial match, 4. Any
    let voice = this.voices.find(v => v.lang === langCode && v.localService);
    if (!voice) {
      voice = this.voices.find(v => v.lang === langCode);
    }
    if (!voice) {
      voice = this.voices.find(v => v.lang.startsWith(currentLang));
    }
    if (!voice) {
      voice = this.voices[0]; // Fallback to first available
    }

    this.selectedVoice = voice;
  }

  /**
   * Speak text
   * @param {string} text - Text to speak
   * @param {Object} options - Optional settings (rate, pitch, volume)
   */
  async speak(text, options = {}) {
    if (!this.isSupported) {
      if (this.onErrorCallback) {
        this.onErrorCallback('Text-to-speech not supported in this browser');
      }
      return;
    }

    // Stop any current speech
    this.stop();

    // Clean text for better speech
    const cleanText = this.cleanTextForSpeech(text);

    if (!cleanText) {
      return;
    }

    // Route to appropriate TTS method
    if (this.useGoogleCloudTTS) {
      await this.speakWithGoogleCloud(cleanText, options);
    } else {
      this.speakWithWebSpeech(cleanText, options);
    }
  }

  /**
   * Speak using Web Speech API (browser-native)
   */
  speakWithWebSpeech(text, options = {}) {
    // Create utterance
    this.currentUtterance = new SpeechSynthesisUtterance(text);

    // Set voice
    if (this.selectedVoice) {
      this.currentUtterance.voice = this.selectedVoice;
    }

    // Set language
    const currentLang = this.i18n.getCurrentLanguage();
    this.currentUtterance.lang = currentLang === 'ja' ? 'ja-JP' : 'en-US';

    // Set options
    this.currentUtterance.rate = options.rate || this.config.TTS_RATE || 1.0;
    this.currentUtterance.pitch = options.pitch || this.config.TTS_PITCH || 1.0;
    this.currentUtterance.volume = options.volume || this.config.TTS_VOLUME || 1.0;

    // Event handlers
    this.currentUtterance.onstart = () => {
      this.isSpeaking = true;
      this.isPaused = false;
      if (this.onStartCallback) {
        this.onStartCallback();
      }
    };

    this.currentUtterance.onend = () => {
      this.isSpeaking = false;
      this.isPaused = false;
      this.currentUtterance = null;
      if (this.onEndCallback) {
        this.onEndCallback();
      }
    };

    this.currentUtterance.onerror = (event) => {
      errorLogger.log('TextToSpeech', event.error);
      this.isSpeaking = false;
      this.isPaused = false;
      this.currentUtterance = null;
      if (this.onErrorCallback) {
        this.onErrorCallback(event.error);
      }
    };

    // Speak
    this.synthesis.speak(this.currentUtterance);
  }

  /**
   * Speak using Google Cloud Text-to-Speech API
   */
  async speakWithGoogleCloud(text, options = {}) {
    try {
      const currentLang = this.i18n.getCurrentLanguage();
      const languageCode = currentLang === 'ja' ? 'ja-JP' : 'en-US';

      // Select voice name based on current language
      // Only use configured voice if it matches the current language
      let voiceName;
      const configuredVoice = this.config.TTS_GOOGLE_VOICE_NAME;

      if (configuredVoice && configuredVoice.startsWith(languageCode)) {
        // Use configured voice if it matches current language
        voiceName = configuredVoice;
      } else {
        // Auto-select appropriate voice for current language
        voiceName = currentLang === 'ja' ? 'ja-JP-Neural2-B' : 'en-US-Neural2-F';
      }

      // Prepare request
      const requestBody = {
        provider: 'google-tts',
        text: text,
        languageCode: languageCode,
        voiceName: voiceName,
        speakingRate: options.rate || this.config.TTS_RATE || 1.0,
        pitch: options.pitch || this.config.TTS_PITCH || 0.0, // Google uses -20 to 20
        volumeGainDb: options.volume ? (options.volume - 1) * 16 : 0 // Convert 0-1 to -16 to 16 dB
      };

      // Call Lambda proxy
      const response = await fetch(this.lambdaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Google Cloud TTS failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Get audio content (base64)
      const audioContent = data.audioContent;

      if (!audioContent) {
        throw new Error('No audio content received from Google Cloud TTS');
      }

      // Play the audio
      await this.playAudioFromBase64(audioContent);

    } catch (error) {
      errorLogger.log('GoogleCloudTTS', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error.message || 'Google Cloud TTS failed');
      }
    }
  }

  /**
   * Play audio from base64 string
   */
  async playAudioFromBase64(base64Audio) {
    return new Promise((resolve, reject) => {
      // Clean up previous audio
      if (this.currentAudioUrl) {
        URL.revokeObjectURL(this.currentAudioUrl);
        this.currentAudioUrl = null;
      }

      // Convert base64 to blob
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });

      // Create object URL
      this.currentAudioUrl = URL.createObjectURL(audioBlob);

      // Create or reuse audio element
      if (!this.audioElement) {
        this.audioElement = new Audio();
      }

      this.audioElement.src = this.currentAudioUrl;

      // Event handlers
      this.audioElement.onplay = () => {
        this.isSpeaking = true;
        this.isPaused = false;
        if (this.onStartCallback) {
          this.onStartCallback();
        }
      };

      this.audioElement.onended = () => {
        this.isSpeaking = false;
        this.isPaused = false;
        if (this.onEndCallback) {
          this.onEndCallback();
        }
        resolve();
      };

      this.audioElement.onerror = (error) => {
        this.isSpeaking = false;
        this.isPaused = false;
        errorLogger.log('AudioPlayback', error);
        if (this.onErrorCallback) {
          this.onErrorCallback('Audio playback failed');
        }
        reject(error);
      };

      // Play
      this.audioElement.play().catch(error => {
        errorLogger.log('AudioPlayStart', error);
        if (this.onErrorCallback) {
          this.onErrorCallback('Failed to start audio playback');
        }
        reject(error);
      });
    });
  }

  /**
   * Clean text for better speech output
   * Removes markdown, emojis, verbose data (addresses, prices, hours, phone numbers)
   */
  cleanTextForSpeech(text) {
    if (!text) return '';

    let cleaned = text;

    // Remove markdown formatting
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1'); // Bold
    cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');     // Italic
    cleaned = cleaned.replace(/`(.*?)`/g, '$1');       // Code
    cleaned = cleaned.replace(/\[(.*?)\]\(.*?\)/g, '$1'); // Links

    // Remove parenthetical content (Japanese translations, supplemental info)
    cleaned = cleaned.replace(/\([^)]*\)/g, '');

    // Remove star/number markers for POI rankings
    cleaned = cleaned.replace(/[⭐✨🌟]+\d*/g, ''); // Stars with optional numbers
    cleaned = cleaned.replace(/^\d+\.\s*/gm, '');   // Leading numbers like "1. ", "2. "

    // Remove addresses (entire lines containing address patterns)
    cleaned = cleaned.replace(/Address:.*?(?=\n|$)/gi, '');
    cleaned = cleaned.replace(/.*?[都道府県市区町村].*?(?=\n|$)/g, ''); // Japanese addresses
    cleaned = cleaned.replace(/.*?-ku\b.*?(?=\n|$)/gi, ''); // Ward names like "Shibuya-ku"

    // Remove phone numbers
    cleaned = cleaned.replace(/Tel:.*?(?=\n|$)/gi, '');
    cleaned = cleaned.replace(/Phone:.*?(?=\n|$)/gi, '');
    cleaned = cleaned.replace(/電話.*?(?=\n|$)/g, '');
    cleaned = cleaned.replace(/\b\d{2,4}[-.]?\d{4}[-.]?\d{4}\b/g, ''); // Phone patterns

    // Remove opening hours / time ranges
    cleaned = cleaned.replace(/\d{1,2}:\d{2}\s*[-~]\s*\d{1,2}:\d{2}/g, ''); // 11:00-23:00
    cleaned = cleaned.replace(/営業時間.*?(?=\n|$)/g, ''); // Japanese hours
    cleaned = cleaned.replace(/Hours:.*?(?=\n|$)/gi, '');

    // Remove prices
    cleaned = cleaned.replace(/¥[\d,]+(?:\s*[-~]\s*¥?[\d,]+)?/g, ''); // ¥980 or ¥1,800-3,000
    cleaned = cleaned.replace(/価格情報なし/g, ''); // "No price info"
    cleaned = cleaned.replace(/Price.*?(?=\n|$)/gi, '');

    // Remove coordinates
    cleaned = cleaned.replace(/\d+\.\d+\s*,\s*\d+\.\d+/g, ''); // Lat/lng pairs
    cleaned = cleaned.replace(/\d+°[NS]\s*,\s*\d+°[EW]/g, ''); // Degree notation

    // Remove "not available" statements for missing data
    cleaned = cleaned.replace(/営業時間情報なし/g, '');
    cleaned = cleaned.replace(/電話番号情報なし/g, '');
    cleaned = cleaned.replace(/Hours not available/gi, '');
    cleaned = cleaned.replace(/Phone not listed/gi, '');
    cleaned = cleaned.replace(/Price not listed/gi, '');

    // Remove emojis (they don't speak well)
    cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
    cleaned = cleaned.replace(/[\u{1F300}-\u{1F5FF}]/gu, ''); // Misc Symbols
    cleaned = cleaned.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport
    cleaned = cleaned.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ''); // Flags
    cleaned = cleaned.replace(/[\u{2600}-\u{26FF}]/gu, '');   // Misc symbols
    cleaned = cleaned.replace(/[\u{2700}-\u{27BF}]/gu, '');   // Dingbats

    // Remove multiple spaces/newlines
    cleaned = cleaned.replace(/\s+/g, ' ');

    // Remove extra punctuation artifacts
    cleaned = cleaned.replace(/\s*[-,]\s*$/gm, ''); // Trailing dashes/commas
    cleaned = cleaned.replace(/\s+[-,]\s+/g, ' '); // Isolated dashes/commas

    // Trim
    cleaned = cleaned.trim();

    return cleaned;
  }

  /**
   * Pause speech
   */
  pause() {
    if (!this.isSpeaking || this.isPaused) {
      return;
    }

    if (this.useGoogleCloudTTS && this.audioElement) {
      this.audioElement.pause();
      this.isPaused = true;
    } else if (this.synthesis) {
      this.synthesis.pause();
      this.isPaused = true;
    }
  }

  /**
   * Resume speech
   */
  resume() {
    if (!this.isPaused) {
      return;
    }

    if (this.useGoogleCloudTTS && this.audioElement) {
      this.audioElement.play();
      this.isPaused = false;
    } else if (this.synthesis) {
      this.synthesis.resume();
      this.isPaused = false;
    }
  }

  /**
   * Stop speech
   */
  stop() {
    // Stop Web Speech API
    if (this.synthesis) {
      this.synthesis.cancel();
      this.currentUtterance = null;
    }

    // Stop audio playback (Google Cloud TTS)
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }

    // Clean up audio URL
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }

    this.isSpeaking = false;
    this.isPaused = false;
  }

  /**
   * Toggle auto-speak mode
   */
  toggleAutoSpeak() {
    this.autoSpeakEnabled = !this.autoSpeakEnabled;
    return this.autoSpeakEnabled;
  }

  /**
   * Enable auto-speak mode
   */
  enableAutoSpeak() {
    this.autoSpeakEnabled = true;
  }

  /**
   * Disable auto-speak mode
   */
  disableAutoSpeak() {
    this.autoSpeakEnabled = false;
  }

  /**
   * Check if auto-speak is enabled
   */
  isAutoSpeakEnabled() {
    return this.autoSpeakEnabled;
  }

  /**
   * Get available voices for current language
   */
  getVoicesForCurrentLanguage() {
    const currentLang = this.i18n.getCurrentLanguage();
    const langCode = currentLang === 'ja' ? 'ja' : 'en';

    return this.voices.filter(voice =>
      voice.lang.startsWith(langCode)
    );
  }

  /**
   * Set voice by name
   */
  setVoice(voiceName) {
    const voice = this.voices.find(v => v.name === voiceName);
    if (voice) {
      this.selectedVoice = voice;
      return true;
    }
    return false;
  }

  /**
   * Set callback for speech start
   */
  onStart(callback) {
    this.onStartCallback = callback;
  }

  /**
   * Set callback for speech end
   */
  onEnd(callback) {
    this.onEndCallback = callback;
  }

  /**
   * Set callback for errors
   */
  onError(callback) {
    this.onErrorCallback = callback;
  }

  /**
   * Check if TTS is supported
   */
  isAvailable() {
    return this.isSupported;
  }

  /**
   * Get current speaking state
   */
  getSpeakingState() {
    return {
      isSpeaking: this.isSpeaking,
      isPaused: this.isPaused,
      autoSpeakEnabled: this.autoSpeakEnabled
    };
  }

  /**
   * Get the current TTS method being used
   */
  getTTSMethod() {
    if (this.useGoogleCloudTTS) {
      return 'Google Cloud Text-to-Speech (WaveNet/Neural2)';
    } else {
      return 'Web Speech API (Browser Native)';
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.stop();

    // Clean up audio element
    if (this.audioElement) {
      this.audioElement.src = '';
      this.audioElement = null;
    }

    // Clean up audio URL
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }

    this.onStartCallback = null;
    this.onEndCallback = null;
    this.onErrorCallback = null;
  }
}
