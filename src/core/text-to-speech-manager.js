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

    // Summary cache (to avoid re-calling API for same text)
    this.summaryCache = new Map();
    this.maxCacheSize = 50; // Cache up to 50 summaries

    // Audio cache (to avoid re-generating audio for same text)
    this.audioCache = new Map();
    this.maxAudioCacheSize = 20; // Cache up to 20 audio files

    // Callbacks
    this.onPreparingCallback = null; // Called when starting to prepare summary
    this.onStartCallback = null;     // Called when audio actually starts playing
    this.onEndCallback = null;
    this.onErrorCallback = null;

    // Thinking speech state (for filling wait time with contextual small talk)
    this.isPlayingThinkingSpeech = false;
    this.thinkingSpeechController = null; // AbortController to cancel thinking speech generation

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

    // Check if we have cached audio for this text (Google Cloud TTS only)
    if (this.useGoogleCloudTTS && this.audioCache.has(text)) {
      const cachedAudioUrl = this.audioCache.get(text);
      await this.playCachedAudio(cachedAudioUrl);
      return;
    }

    // Get AI summary for speech (if enabled)
    let speechText = text;
    if (this.config.TTS_USE_AI_SUMMARY) {
      // Check cache first
      if (this.summaryCache.has(text)) {
        speechText = this.summaryCache.get(text);
      } else {
        // Notify UI that we're preparing summary
        if (this.onPreparingCallback) {
          this.onPreparingCallback();
        }

        // Generate new summary
        try {
          speechText = await this.getSpeechSummary(text);
          // Cache the summary
          this.cacheSummary(text, speechText);
        } catch (error) {
          errorLogger.log('SpeechSummary', error);
          // If summary fails, don't speak (user requested no fallback)
          if (this.onErrorCallback) {
            this.onErrorCallback('Failed to generate speech summary');
          }
          return;
        }
      }
    }

    if (!speechText) {
      return;
    }

    // Route to appropriate TTS method
    if (this.useGoogleCloudTTS) {
      await this.speakWithGoogleCloud(speechText, options, text);
    } else {
      this.speakWithWebSpeech(speechText, options);
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
   * @param {string} text - Summarized text to speak
   * @param {Object} options - Voice options
   * @param {string} originalText - Original text (for caching audio)
   */
  async speakWithGoogleCloud(text, options = {}, originalText = null) {
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

      // Convert base64 to blob and create URL
      const binaryString = atob(audioContent);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);

      // Cache the audio URL BEFORE playing (for instant replay)
      if (originalText) {
        this.cacheAudio(originalText, audioUrl);
      }

      // Now play the audio (don't await - let it play in background)
      this.playAudioFromUrl(audioUrl).catch(error => {
        errorLogger.log('AudioPlayback', error);
      });

    } catch (error) {
      errorLogger.log('GoogleCloudTTS', error);
      if (this.onErrorCallback) {
        this.onErrorCallback(error.message || 'Google Cloud TTS failed');
      }
    }
  }

  /**
   * Play audio from URL
   * @param {string} audioUrl - Blob URL to play
   * @returns {Promise<void>} Resolves when audio finishes playing
   */
  async playAudioFromUrl(audioUrl) {
    return new Promise((resolve, reject) => {
      this.currentAudioUrl = audioUrl;

      // Create or reuse audio element
      if (!this.audioElement) {
        this.audioElement = new Audio();
      }

      this.audioElement.src = audioUrl;

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
   * Cache a summary with LRU eviction
   */
  cacheSummary(text, summary) {
    // If cache is full, remove oldest entry (LRU)
    if (this.summaryCache.size >= this.maxCacheSize) {
      const firstKey = this.summaryCache.keys().next().value;
      this.summaryCache.delete(firstKey);
    }
    this.summaryCache.set(text, summary);
  }

  /**
   * Cache an audio URL with LRU eviction
   */
  cacheAudio(text, audioUrl) {
    // If cache is full, remove oldest entry and revoke its URL (LRU)
    if (this.audioCache.size >= this.maxAudioCacheSize) {
      const firstKey = this.audioCache.keys().next().value;
      const oldUrl = this.audioCache.get(firstKey);
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
      }
      this.audioCache.delete(firstKey);
    }
    this.audioCache.set(text, audioUrl);
  }

  /**
   * Play audio from cached URL (instant playback)
   */
  async playCachedAudio(audioUrl) {
    // Reuse the same playback logic
    return this.playAudioFromUrl(audioUrl);
  }

  /**
   * Get AI-generated summary optimized for text-to-speech
   * Sends the full text to AI for intelligent summarization
   */
  async getSpeechSummary(text) {
    if (!text) return '';

    try {
      const currentLang = this.i18n.getCurrentLanguage();
      const languageInstruction = currentLang === 'ja'
        ? 'Respond in Japanese.'
        : 'Respond in English.';

      const response = await fetch(this.lambdaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          temperature: 0.3, // Lower temperature for consistent summaries
          messages: [{
            role: 'user',
            content: `Summarize this text for text-to-speech audio. Keep only the natural conversational content that sounds good when spoken aloud. ${languageInstruction}

RULES:
- Remove ALL addresses, phone numbers, opening hours, prices, coordinates, and emojis
- Remove parenthetical content (translations, supplemental info)
- Remove star markers (⭐), number prefixes (1., 2., 3.), and horizontal rules (---)
- Keep the essential information: place names and their key descriptions
- Be concise and natural - optimize for listening, not reading
- Preserve the language of place names exactly as written

Text to summarize:
${text}`
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Speech summary API failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Extract summary text from response
      let summary = '';
      if (data.content && Array.isArray(data.content)) {
        // Claude response format
        const textContent = data.content.find(item => item.type === 'text');
        summary = textContent ? textContent.text : '';
      } else if (data.message) {
        // Alternative format
        summary = data.message;
      }

      return summary.trim();

    } catch (error) {
      errorLogger.log('GetSpeechSummary', error);
      throw error;
    }
  }

  /**
   * Generate contextual thinking speech (small talk while waiting for search)
   * @param {string} question - User's question
   * @returns {Promise<string>} Generated thinking speech content
   */
  async generateThinkingSpeech(question) {
    if (!question) return '';

    try {
      const currentLang = this.i18n.getCurrentLanguage();
      const languageInstruction = currentLang === 'ja'
        ? 'Respond entirely in Japanese.'
        : 'Respond entirely in English.';

      const intro = currentLang === 'ja'
        ? '検索している間に、興味深いことをお話ししますね。'
        : 'While I search, let me tell you something interesting.';

      const response = await fetch(this.lambdaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          temperature: 0.7, // Slightly higher for more conversational tone
          messages: [{
            role: 'user',
            content: `Generate about 1 minute of friendly, conversational small talk related to: "${question}"

${languageInstruction}

RULES:
- Start with: "${intro}"
- Be warm, conversational, and educational
- Share interesting facts or context about the topic
- Keep it natural and engaging, as if chatting with a friend
- Make it about 200-250 words (roughly 1 minute of speech)
- Focus on general context, history, or interesting tidbits
- Do NOT provide specific recommendations or answers
- End naturally without prompting questions

Example topics to cover:
- Historical context
- Cultural significance
- Interesting facts
- General characteristics of the area/topic`
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Thinking speech API failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Extract speech text from response
      let speechText = '';
      if (data.content && Array.isArray(data.content)) {
        const textContent = data.content.find(item => item.type === 'text');
        speechText = textContent ? textContent.text : '';
      } else if (data.message) {
        speechText = data.message;
      }

      return speechText.trim();

    } catch (error) {
      errorLogger.log('GenerateThinkingSpeech', error);
      throw error;
    }
  }

  /**
   * Start thinking speech (plays while waiting for main search)
   * @param {string} question - User's question
   */
  async speakThinkingSpeech(question) {
    if (this.isPlayingThinkingSpeech) {
      return; // Already playing
    }

    try {
      // Create abort controller for cancellation
      this.thinkingSpeechController = new AbortController();

      this.isPlayingThinkingSpeech = true;

      // Generate thinking speech
      const thinkingText = await this.generateThinkingSpeech(question);

      // Check if we were cancelled while generating
      if (this.thinkingSpeechController.signal.aborted) {
        this.isPlayingThinkingSpeech = false;
        return;
      }

      if (!thinkingText) {
        this.isPlayingThinkingSpeech = false;
        return;
      }

      // Speak the thinking content (using existing speak method infrastructure)
      // We'll use speakWithGoogleCloud directly to avoid caching and summary processing
      if (this.useGoogleCloudTTS) {
        await this.speakWithGoogleCloud(thinkingText, {});
      } else {
        this.speakWithWebSpeech(thinkingText, {});
      }

    } catch (error) {
      errorLogger.log('SpeakThinkingSpeech', error);
      this.isPlayingThinkingSpeech = false;
    }
  }

  /**
   * Interrupt thinking speech with graceful transition
   * Speaks a transition phrase then stops
   */
  async interruptThinkingSpeech() {
    if (!this.isPlayingThinkingSpeech) {
      return;
    }

    // Cancel any pending thinking speech generation
    if (this.thinkingSpeechController) {
      this.thinkingSpeechController.abort();
    }

    // Stop current speech
    this.stop();

    // Speak transition phrase
    const currentLang = this.i18n.getCurrentLanguage();
    const transitionPhrase = currentLang === 'ja'
      ? 'あ、結果が出ました！'
      : 'Oh, got the results!';

    this.isPlayingThinkingSpeech = false;

    // Speak transition (brief, so don't cache or summarize)
    if (this.useGoogleCloudTTS) {
      await this.speakWithGoogleCloud(transitionPhrase, {});
    } else {
      this.speakWithWebSpeech(transitionPhrase, {});
    }
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

    // Don't revoke audio URL here - it might be cached for replay
    // URLs are managed by the cache and revoked during cleanup

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
   * Set callback for when preparing summary (before speech starts)
   */
  onPreparing(callback) {
    this.onPreparingCallback = callback;
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

    // Stop thinking speech
    if (this.thinkingSpeechController) {
      this.thinkingSpeechController.abort();
      this.thinkingSpeechController = null;
    }
    this.isPlayingThinkingSpeech = false;

    // Clean up audio element
    if (this.audioElement) {
      this.audioElement.src = '';
      this.audioElement = null;
    }

    // Clean up current audio URL
    if (this.currentAudioUrl && !this.audioCache.has(this.currentAudioUrl)) {
      // Only revoke if it's not in the cache
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }

    // Clean up all cached audio URLs
    if (this.audioCache) {
      for (const audioUrl of this.audioCache.values()) {
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
        }
      }
      this.audioCache.clear();
    }

    // Clear summary cache
    if (this.summaryCache) {
      this.summaryCache.clear();
    }

    this.onPreparingCallback = null;
    this.onStartCallback = null;
    this.onEndCallback = null;
    this.onErrorCallback = null;
  }
}
