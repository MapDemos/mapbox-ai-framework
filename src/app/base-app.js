/**
 * BaseApp - Common Application Logic
 *
 * This base class provides all the common boilerplate needed for building
 * AI-powered location-based applications:
 * - UI management (chat, loading, modals)
 * - Event handling
 * - Rate limiting
 * - Input validation
 * - Error handling
 *
 * Extend this class and implement domain-specific logic in your app.
 */

import { I18n, ThinkingSimulator, errorLogger, isLocationInBounds, getUserLocation, SpeechRecognitionManager, TextToSpeechManager } from '@mapdemos/ai-framework/core';
import { MapController } from '@mapdemos/ai-framework/map';
import { ClaudeClient, GeminiClient } from '@mapdemos/ai-framework/ai';

/**
 * Async error handling wrapper
 * Wraps async functions to provide consistent error handling
 */
export function asyncErrorWrapper(fn, options = {}) {
  const {
    context = 'Unknown',
    fallback = null,
    logError = true,
    rethrow = false
  } = options;

  return async function(...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      if (logError) {
        errorLogger.log(context, error, { args });
      }

      if (rethrow) {
        throw error;
      }

      return fallback;
    }
  };
}

export class BaseApp {
  constructor(config, translations, thinkingMessages) {
    this.config = config;
    this.i18n = new I18n(config.DEFAULT_LANGUAGE, translations);
    this.thinkingSimulator = thinkingMessages ?
      new ThinkingSimulator(this.i18n, thinkingMessages) : null;

    this.mapController = null;
    this.claudeClient = null;
    this.isProcessing = false;
    this.mapViewUpdateTimer = null;
    this.userLocation = null;

    // Speech recognition
    this.speechRecognitionManager = null;

    // Text-to-speech
    this.textToSpeechManager = null;
    this.currentPreparingMessageId = null; // Message being prepared for TTS
    this.currentSpeakingMessageId = null;   // Message currently speaking

    // Rate limiting (Token Bucket Algorithm)
    this.lastRequestTime = 0;
    this.MIN_REQUEST_INTERVAL = this.config.REQUEST_RATE_LIMIT_MS;
    this.rateLimitTokens = this.config.RATE_LIMIT_BURST_CAPACITY;
    this.MAX_RATE_LIMIT_TOKENS = this.config.RATE_LIMIT_BURST_CAPACITY;
    this.RATE_LIMIT_REFILL_RATE = this.config.RATE_LIMIT_REFILL_RATE;
    this.lastRefillTime = Date.now();

    // Input validation
    this.MAX_INPUT_LENGTH = this.config.MAX_INPUT_LENGTH;

    // Request queue for handling race conditions
    this.requestQueue = [];
    this.activeRequest = null;
    this.isClearing = false;

    // Store event handler references for cleanup
    this.eventHandlers = {};
    this.mapEventHandlers = {};

    // AbortController for automatic event cleanup
    this.abortController = new AbortController();
  }

  /**
   * Initialize the application
   * Generic initialization flow that works for most apps.
   * Subclasses should implement hooks (getDataSources, getSystemPromptBuilder, etc.)
   * instead of overriding this method.
   */
  async initialize() {
    try {
      // Validate configuration (subclasses can override validateConfig())
      if (!this.validateConfig()) {
        this.showConfigError();
        return;
      }

      // Show welcome message
      this.addSystemMessage(this.i18n.t('system.welcome'));

      // Initialize data sources (provided by subclass)
      const dataSources = await this.getDataSources();

      // Initialize Map Controller
      this.mapController = new MapController(this.config, this);
      await this.mapController.initialize('map');

      // Set initial map language
      this.mapController.setMapLanguage(this.i18n.getCurrentLanguage());

      // Setup map event handlers (subclass can add more in onMapReady())
      this.mapEventHandlers.moveend = () => {
        this.updateClaudeMapContext();
      };
      this.mapController.map.on('moveend', this.mapEventHandlers.moveend);

      // Hook for subclass to setup domain-specific map handlers
      await this.onMapReady();

      // Initialize AI Client (Claude or Gemini)
      if (this.config.AI_PROVIDER === 'gemini') {
        // Legacy Gemini support (uses positional args)
        this.claudeClient = new GeminiClient(
          this.config.GEMINI_API_KEY,
          dataSources[0], // First data source for backward compatibility
          this.mapController,
          this.i18n,
          this.config
        );
      } else {
        // Modern Claude client with hooks
        this.claudeClient = new ClaudeClient({
          apiKey: this.config.CLAUDE_API_KEY,
          dataSources: dataSources,
          mapController: this.mapController,
          i18n: this.i18n,
          config: this.config,
          app: this,
          systemPromptBuilder: this.getSystemPromptBuilder(),
          onDataCallback: this.getDataCallback(),
          thinkingSimulator: this.thinkingSimulator
        });
      }

      // Setup global error handlers
      this.setupGlobalErrorHandlers();

      // Setup event listeners
      this.setupEventListeners();

      // Initialize speech recognition if enabled
      if (this.config.SPEECH_RECOGNITION_ENABLED !== false) {
        this.initializeSpeechRecognition();
      }

      // Initialize text-to-speech if enabled
      if (this.config.TTS_ENABLED !== false) {
        this.initializeTextToSpeech();
      }

      // Hook for subclass post-initialization logic
      await this.onInitialized();

    } catch (error) {
      errorLogger.log('Initialization', error);
      this.showError(
        this.i18n.t('error.initializationTitle'),
        this.i18n.t('error.initializationMessage')
      );
    }
  }

  /**
   * Validate configuration
   * Subclasses can override to provide custom validation
   * @returns {boolean} True if config is valid
   */
  validateConfig() {
    // Default: just check if config exists
    return !!this.config;
  }

  /**
   * Get data sources for AI client
   * Subclasses MUST override this to provide domain-specific data sources
   * @returns {Promise<Array>} Array of data source instances (MCPs, APIs, etc.)
   */
  async getDataSources() {
    return [];
  }

  /**
   * Get system prompt builder function
   * Subclasses can override to provide domain-specific prompts
   * @returns {Function|null} System prompt builder function
   */
  getSystemPromptBuilder() {
    return null;
  }

  /**
   * Get data callback for handling tool results
   * Subclasses can override to handle domain-specific data processing
   * @returns {Function|null} Data callback function
   */
  getDataCallback() {
    return null;
  }

  /**
   * Hook called after map is ready
   * Subclasses can override to setup domain-specific map handlers
   */
  async onMapReady() {
    // Subclasses can override
  }

  /**
   * Hook called after initialization is complete
   * Default implementation shows user location if AUTO_SHOW_USER_LOCATION is enabled
   * Subclasses can override for additional post-initialization logic
   */
  async onInitialized() {
    // Auto-show user location if enabled in config
    if (this.config.AUTO_SHOW_USER_LOCATION !== false) {
      await this.showUserLocationAuto();
    }
  }

  /**
   * Show user location automatically
   * Silently fails if geolocation is denied or unavailable
   */
  async showUserLocationAuto() {
    try {
      const location = await getUserLocation();
      this.userLocation = location;

      // Center map on user location
      if (this.mapController) {
        this.mapController.recenterToUser(this.userLocation);
      }

      // Update AI client context
      if (this.claudeClient) {
        this.claudeClient.userLocation = this.userLocation;
      }
    } catch (error) {
      // Silently fail - user location is optional
      // Most common errors: permission denied, position unavailable
      errorLogger.log('ShowUserLocation', error);
    }
  }

  /**
   * Setup global error handlers
   * Subclasses can override to add custom handling
   */
  setupGlobalErrorHandlers() {
    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      errorLogger.log('UnhandledRejection', event.reason);
      event.preventDefault();
    }, { signal: this.abortController.signal });

    // Global errors
    window.addEventListener('error', (event) => {
      errorLogger.log('GlobalError', event.error || event.message);
    }, { signal: this.abortController.signal });

    // Security: Block loading external scripts
    if (typeof document !== 'undefined') {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.tagName === 'SCRIPT' && node.src && !this.isAllowedScriptOrigin(node.src)) {
              node.remove();
              errorLogger.log('SecurityViolation', `Blocked unauthorized script: ${node.src}`);
            }
          });
        });
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      // Store observer for cleanup
      this.scriptObserver = observer;
    }
  }

  /**
   * Check if script origin is allowed
   * Subclasses can override to customize allowed origins
   */
  isAllowedScriptOrigin(src) {
    const allowedOrigins = [
      window.location.origin,
      'https://api.mapbox.com',
      'https://unpkg.com',
      'https://cdn.jsdelivr.net'
    ];

    return allowedOrigins.some(origin => src.startsWith(origin));
  }

  /**
   * Setup event listeners
   * Subclasses should call super.setupEventListeners() and add their own
   */
  setupEventListeners() {
    // Send button
    this.eventHandlers.send = asyncErrorWrapper(
      () => this.handleUserInput(),
      { context: 'SendButton' }
    );
    document.getElementById('sendBtn')?.addEventListener(
      'click',
      this.eventHandlers.send,
      { signal: this.abortController.signal }
    );

    // Enter key in input
    this.eventHandlers.enterKey = asyncErrorWrapper(
      (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleUserInput();
        }
      },
      { context: 'EnterKey' }
    );
    document.getElementById('chatInput')?.addEventListener(
      'keypress',
      this.eventHandlers.enterKey,
      { signal: this.abortController.signal }
    );

    // Language toggle
    this.eventHandlers.langToggle = () => this.toggleLanguage();
    document.getElementById('lang-toggle')?.addEventListener(
      'click',
      this.eventHandlers.langToggle,
      { signal: this.abortController.signal }
    );

    // Clear chat
    this.eventHandlers.clearChat = asyncErrorWrapper(
      () => this.clearConversation(),
      { context: 'ClearChat' }
    );
    document.getElementById('clearChatBtn')?.addEventListener(
      'click',
      this.eventHandlers.clearChat,
      { signal: this.abortController.signal }
    );

    // Close modals
    this.eventHandlers.closeError = () => this.hideError();
    document.getElementById('closeErrorModal')?.addEventListener(
      'click',
      this.eventHandlers.closeError,
      { signal: this.abortController.signal }
    );

    // Microphone button for speech recognition
    this.eventHandlers.micButton = asyncErrorWrapper(
      () => this.toggleSpeechRecognition(),
      { context: 'MicButton' }
    );
    document.getElementById('micBtn')?.addEventListener(
      'click',
      this.eventHandlers.micButton,
      { signal: this.abortController.signal }
    );

    // Auto-speak toggle button for text-to-speech
    this.eventHandlers.ttsToggle = () => this.toggleTextToSpeech();
    document.getElementById('tts-toggle')?.addEventListener(
      'click',
      this.eventHandlers.ttsToggle,
      { signal: this.abortController.signal }
    );
  }

  /**
   * Refill rate limit tokens
   */
  refillRateLimitTokens() {
    const now = Date.now();
    const timePassed = now - this.lastRefillTime;
    const tokensToAdd = Math.floor(timePassed / 1000) * this.RATE_LIMIT_REFILL_RATE;

    if (tokensToAdd > 0) {
      this.rateLimitTokens = Math.min(
        this.MAX_RATE_LIMIT_TOKENS,
        this.rateLimitTokens + tokensToAdd
      );
      this.lastRefillTime = now;
    }
  }

  /**
   * Check rate limit
   */
  checkRateLimit() {
    this.refillRateLimitTokens();

    if (this.rateLimitTokens < 1) {
      return false;
    }

    this.rateLimitTokens--;
    return true;
  }

  /**
   * Handle user input
   */
  async handleUserInput() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (!message || this.isProcessing) {
      return;
    }

    // Check rate limit
    if (!this.checkRateLimit()) {
      this.showError(
        this.i18n.t('error.rateLimitTitle'),
        this.i18n.t('error.rateLimitMessage')
      );
      return;
    }

    // Sanitize and validate input
    const sanitizedMessage = this.sanitizeUserInput(message);
    if (sanitizedMessage.length > this.MAX_INPUT_LENGTH) {
      this.showError(
        this.i18n.t('error.inputTooLongTitle'),
        this.i18n.t('error.inputTooLongMessage', { max: this.MAX_INPUT_LENGTH })
      );
      return;
    }

    // Clear input immediately
    input.value = '';

    // Queue the request
    this.requestQueue.push(sanitizedMessage);
    await this.processRequestQueue();
  }

  /**
   * Process request queue
   */
  async processRequestQueue() {
    if (this.activeRequest || this.requestQueue.length === 0 || this.isClearing) {
      return;
    }

    this.activeRequest = this.requestQueue.shift();

    try {
      await this.processUserMessage(this.activeRequest);
    } finally {
      this.activeRequest = null;

      // Process next request if queue not empty
      if (this.requestQueue.length > 0) {
        await this.processRequestQueue();
      }
    }
  }

  /**
   * Sanitize user input
   */
  sanitizeUserInput(input) {
    return input
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
      .replace(/<object[^>]*>.*?<\/object>/gi, '')
      .replace(/<embed[^>]*>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .substring(0, this.MAX_INPUT_LENGTH);
  }

  /**
   * Process user message
   * Default implementation for AI conversation flow.
   * Override only if you need custom error handling or additional logic.
   */
  async processUserMessage(message) {
    if (!this.claudeClient) {
      throw new Error('AI client not initialized. Set this.claudeClient in your initialize() method.');
    }

    this.isProcessing = true;

    try {
      // Add user message to chat
      this.addUserMessage(message);

      // Show thinking display and start thinking simulator
      if (this.thinkingSimulator) {
        const thinkingDisplay = document.getElementById('thinkingDisplay');
        const thinkingSteps = document.getElementById('thinkingSteps');
        if (thinkingDisplay && thinkingSteps) {
          thinkingDisplay.style.display = 'block';
          this.thinkingSimulator.startThinking(message, thinkingSteps);
        }
      }

      // Start thinking speech if TTS auto-speak is enabled and feature is configured
      const useThinkingSpeech = this.config.TTS_USE_THINKING_SPEECH !== false; // Default true
      if (this.textToSpeechManager &&
          this.textToSpeechManager.isAutoSpeakEnabled() &&
          useThinkingSpeech) {
        // Start thinking speech in parallel (don't await - let it run in background)
        this.textToSpeechManager.speakThinkingSpeech(message).catch(error => {
          errorLogger.log('ThinkingSpeech', error);
        });
      }

      // Send to AI
      const response = await this.claudeClient.sendMessage(message);

      // Interrupt thinking speech if it's still playing
      if (this.textToSpeechManager && this.textToSpeechManager.isPlayingThinkingSpeech) {
        await this.textToSpeechManager.interruptThinkingSpeech();
      }

      // Add assistant response
      this.addAssistantMessage(response.text, response.thinking);

      // Update token counter
      this.updateTokenCounter();

    } catch (error) {
      // Handle common AI errors
      if (error.message?.includes('context_length_exceeded')) {
        this.showError(
          this.i18n.t('error.tokenOverflowTitle'),
          this.i18n.t('error.tokenOverflowMessage')
        );
      } else {
        errorLogger.log('ProcessMessage', error);
        this.showError(
          this.i18n.t('error.processingTitle'),
          this.i18n.t('error.processingMessage')
        );
      }
    } finally {
      // Always hide thinking display and stop thinking simulator
      if (this.thinkingSimulator) {
        const thinkingDisplay = document.getElementById('thinkingDisplay');
        if (thinkingDisplay) {
          thinkingDisplay.style.display = 'none';
        }
        this.thinkingSimulator.stopThinking();
      }

      this.isProcessing = false;
    }
  }

  /**
   * Toggle language
   */
  toggleLanguage() {
    this.i18n.toggleLanguage();
    this.updateUI();

    // Update map language if available
    const currentLang = this.i18n.getCurrentLanguage();
    if (this.mapController) {
      this.mapController.setMapLanguage(currentLang);
    }

    // Rebuild Claude system prompt with new language if available
    if (this.claudeClient && this.claudeClient.buildSystemPrompt) {
      // Use current mapView from ClaudeClient, or null if not set
      const mapView = this.claudeClient.mapView || null;
      this.claudeClient.systemPrompt = this.claudeClient.buildSystemPrompt(
        this.claudeClient.userLocation,
        mapView
      );
    }

    // Update welcome message in chat (first system message)
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      const firstMessage = chatMessages.querySelector('.message.system-message');
      if (firstMessage) {
        const contentDiv = firstMessage.querySelector('.message-content');
        if (contentDiv) {
          contentDiv.innerHTML = this.formatResponse(this.i18n.t('system.welcome'));
        }
      }
    }
  }

  /**
   * Recenter map to user location or default
   * Delegates to framework MapController.recenterToUser()
   */
  recenterMap() {
    if (this.mapController) {
      this.mapController.recenterToUser(this.userLocation);
    }
  }

  /**
   * Update AI client's context with current map view
   * Debounced to avoid excessive updates during map movement
   */
  updateClaudeMapContext() {
    // Debounce map updates
    if (this.mapViewUpdateTimer) {
      clearTimeout(this.mapViewUpdateTimer);
    }

    this.mapViewUpdateTimer = setTimeout(() => {
      if (!this.claudeClient || !this.mapController) return;

      // Get map context from framework
      const mapContext = this.mapController.getMapContext();
      if (!mapContext) return;

      // Update AI client's map view
      this.claudeClient.mapView = mapContext;
    }, 500);
  }

  /**
   * Check if location is within region bounds
   * Subclasses should define their regionBounds in constructor or config
   * @param {number} longitude - Longitude to check
   * @param {number} latitude - Latitude to check
   * @returns {boolean} True if location is within bounds
   *
   * @example
   * // In your subclass constructor:
   * this.regionBounds = {
   *   north: 45.5,
   *   south: 24.0,
   *   east: 154.0,
   *   west: 122.0
   * };
   */
  isLocationInRegionBounds(longitude, latitude) {
    if (!this.regionBounds) {
      console.warn('regionBounds not defined. Set this.regionBounds in your subclass constructor.');
      return false;
    }

    // Use framework utility
    return isLocationInBounds(longitude, latitude, this.regionBounds);
  }

  /**
   * Check if location is in the target region
   * Convenience method that delegates to isLocationInRegionBounds()
   * Subclasses can define regionName for better semantics (e.g., "Japan", "US", "Europe")
   * @param {number} longitude - Longitude to check
   * @param {number} latitude - Latitude to check
   * @returns {boolean} True if location is in region
   */
  isLocationInRegion(longitude, latitude) {
    return this.isLocationInRegionBounds(longitude, latitude);
  }

  /**
   * Update UI with current language - can be overridden by subclass
   */
  updateUI() {
    const title = document.getElementById('app-title');
    const subtitle = document.getElementById('app-subtitle');
    const langToggle = document.getElementById('lang-toggle');
    const chatInput = document.getElementById('chatInput');
    const sendBtnText = document.getElementById('sendBtnText');

    if (title) title.textContent = this.i18n.t('title');
    if (subtitle) subtitle.textContent = this.i18n.t('subtitle');
    if (langToggle) langToggle.textContent = this.i18n.t('langToggle');
    if (chatInput) chatInput.placeholder = this.i18n.t('inputPlaceholder');
    if (sendBtnText) sendBtnText.textContent = this.i18n.t('sendButton');

    // Update all elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const key = element.dataset.i18n;
      element.textContent = this.i18n.t(key);
    });
  }

  /**
   * Add user message to chat
   */
  addUserMessage(text) {
    this.addMessage('user', text);
  }

  /**
   * Add assistant message to chat
   */
  addAssistantMessage(text, thinking = null) {
    this.addMessage('assistant', text, thinking);
  }

  /**
   * Add system message to chat
   */
  addSystemMessage(text) {
    this.addMessage('system', text);
  }

  /**
   * Add message to chat display
   */
  addMessage(role, content, thinking = null) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message`;

    // Add thinking section if present (for assistant messages)
    if (role === 'assistant' && thinking && thinking.length > 0) {
      const thinkingDiv = document.createElement('details');
      thinkingDiv.className = 'thinking-section';

      const summary = document.createElement('summary');
      summary.textContent = '🤔 Show AI thinking process';
      summary.style.cursor = 'pointer';
      summary.style.color = '#666';
      summary.style.fontSize = '0.9em';
      summary.style.marginBottom = '8px';
      summary.style.userSelect = 'none';

      const thinkingContent = document.createElement('div');
      thinkingContent.className = 'thinking-content';
      thinkingContent.style.backgroundColor = '#f5f5f5';
      thinkingContent.style.padding = '12px';
      thinkingContent.style.borderRadius = '8px';
      thinkingContent.style.marginBottom = '12px';
      thinkingContent.style.fontSize = '0.9em';
      thinkingContent.style.color = '#555';
      thinkingContent.style.fontFamily = 'monospace';
      thinkingContent.style.whiteSpace = 'pre-wrap';
      thinkingContent.style.maxHeight = '300px';
      thinkingContent.style.overflow = 'auto';

      thinkingContent.textContent = thinking.join('\n\n---\n\n');

      thinkingDiv.appendChild(summary);
      thinkingDiv.appendChild(thinkingContent);
      messageDiv.appendChild(thinkingDiv);
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (role === 'user') {
      contentDiv.innerHTML = `<p><strong>You:</strong> ${this.escapeHtml(content)}</p>`;
    } else {
      contentDiv.innerHTML = this.formatResponse(content);
    }

    messageDiv.appendChild(contentDiv);

    // Add speaker icon for assistant messages (if TTS is enabled)
    if (role === 'assistant' && this.textToSpeechManager && this.textToSpeechManager.isAvailable()) {
      const speakerIcon = document.createElement('button');
      speakerIcon.className = 'message-speaker-icon';
      const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      speakerIcon.dataset.messageId = messageId;
      speakerIcon.textContent = '🔊';
      speakerIcon.title = 'Speak this message';
      speakerIcon.style.cssText = `
        background: none;
        border: none;
        cursor: pointer;
        font-size: 1.2em;
        padding: 4px 8px;
        margin-left: 8px;
        opacity: 0.6;
        transition: opacity 0.2s;
      `;

      // Hover effect
      speakerIcon.addEventListener('mouseenter', () => {
        speakerIcon.style.opacity = '1';
      });
      speakerIcon.addEventListener('mouseleave', () => {
        speakerIcon.style.opacity = '0.6';
      });

      // Click handler
      speakerIcon.addEventListener('click', () => {
        if (this.currentSpeakingMessageId === messageId) {
          // Stop if already speaking this message
          this.stopSpeaking();
        } else {
          // Speak this message
          this.speakMessage(content, messageId);
        }
      });

      messageDiv.appendChild(speakerIcon);

      // Auto-speak if enabled
      if (this.textToSpeechManager.isAutoSpeakEnabled()) {
        // Speak after a short delay to allow UI to update
        setTimeout(() => {
          this.speakMessage(content, messageId);
        }, 100);
      }
    }

    chatMessages.appendChild(messageDiv);

    // Scroll to show the new message after the browser has painted the content
    requestAnimationFrame(() => {
      // For assistant messages, scroll to the top of the message so user can read from the start
      // For user messages, scroll to bottom to show the full conversation
      if (role === 'assistant') {
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    });

    // Limit chat history
    const messages = chatMessages.children;
    const maxHistory = this.config.MAX_CHAT_HISTORY || 100;
    while (messages.length > maxHistory) {
      chatMessages.removeChild(messages[0]);
    }
  }

  /**
   * Format response text (markdown-like) with XSS protection
   */
  formatResponse(text) {
    if (!text) return '';

    // Convert markdown to HTML
    let formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');

    // Sanitize with DOMPurify to prevent XSS
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(formatted, {
        ALLOWED_TAGS: ['strong', 'em', 'code', 'br', 'p', 'ul', 'ol', 'li', 'span', 'div'],
        ALLOWED_ATTR: ['class'],
        ALLOW_DATA_ATTR: false,
        FORBID_ATTR: ['style'],
        FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed']
      });
    }

    return this.escapeHtml(formatted);
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Sanitize external data for safe display
   */
  sanitizeExternalData(data) {
    if (!data || typeof data !== 'string') return '';

    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(data, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
        KEEP_CONTENT: true,
        ALLOW_DATA_ATTR: false,
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false
      });
    }

    return this.escapeHtml(data);
  }

  /**
   * Show/hide loading indicator
   */
  showLoading(show) {
    const indicator = document.getElementById('loadingIndicator');
    if (indicator) {
      indicator.style.display = show ? 'flex' : 'none';
    }
  }

  /**
   * Update loading status text
   */
  updateLoadingStatus(status) {
    const loadingText = document.getElementById('loadingText');
    if (loadingText) {
      loadingText.textContent = status;
    }
  }

  /**
   * Update token counter display
   */
  updateTokenCounter() {
    if (!this.claudeClient || !this.claudeClient.getTokenUsage) {
      return;
    }

    const tokenUsage = this.claudeClient.getTokenUsage();
    const tokenCountSpan = document.getElementById('token-count');
    const tokenCounterDiv = document.getElementById('token-counter');

    if (!tokenCountSpan || !tokenCounterDiv || !tokenUsage) {
      return;
    }

    const formatTokens = (num) => {
      if (num === undefined || num === null) {
        return '0';
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
      }
      return num.toString();
    };

    const currentFormatted = formatTokens(tokenUsage.total);
    const maxFormatted = formatTokens(tokenUsage.max);
    const percentage = tokenUsage.percentage || 0;
    tokenCountSpan.textContent = `${currentFormatted} / ${maxFormatted} (${percentage}%)`;

    tokenCounterDiv.classList.remove('warning', 'critical');

    if (percentage >= 70) {
      tokenCounterDiv.classList.add('critical');
    } else if (percentage >= 50) {
      tokenCounterDiv.classList.add('warning');
    }
  }

  /**
   * Clear conversation
   */
  async clearConversation() {
    if (this.isClearing) return;
    this.isClearing = true;

    try {
      // Clear chat messages
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) {
        chatMessages.innerHTML = '';
      }

      // Clear request queue
      this.requestQueue = [];
      this.activeRequest = null;

      // Subclass can override to add custom clear logic
      await this.onClearConversation();

      // Show welcome message
      this.addSystemMessage(this.i18n.t('system.welcome'));
    } finally {
      this.isClearing = false;
    }
  }

  /**
   * Hook for subclasses to add custom clear logic
   * Default implementation clears AI conversation and updates token counter
   * Subclasses should override this to clear domain-specific data and map elements
   */
  async onClearConversation() {
    // Clear AI conversation history
    if (this.claudeClient) {
      this.claudeClient.clearHistory();
    }

    // Update token counter
    this.updateTokenCounter();

    // Note: Map clearing is intentionally left to subclasses since different demos
    // use different map features (markers vs layers, routes vs isochrones, etc.)
    // Subclasses should clear their specific map elements in their override
  }

  /**
   * Show config error
   */
  showConfigError() {
    this.showError(
      this.i18n.t('error.configTitle'),
      this.i18n.t('error.configMessage')
    );
  }

  /**
   * Show error modal
   */
  showError(title, message) {
    const modal = document.getElementById('errorModal');
    const errorMessage = document.getElementById('errorMessage');

    if (modal && errorMessage) {
      modal.querySelector('h3').textContent = title;
      errorMessage.innerHTML = this.formatResponse(message);
      modal.style.display = 'flex';
    }
  }

  /**
   * Hide error modal
   */
  hideError() {
    const modal = document.getElementById('errorModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Initialize speech recognition
   */
  initializeSpeechRecognition() {
    try {
      // Check if speech recognition is supported
      const hasWebSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      const hasMediaRecorder = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

      if (!hasWebSpeech && !hasMediaRecorder) {
        // Hide microphone button if speech recognition is not supported
        const micBtn = document.getElementById('micBtn');
        if (micBtn) {
          micBtn.style.display = 'none';
        }
        return;
      }

      // Initialize speech recognition manager
      const lambdaUrl = this.config.CLAUDE_API_PROXY || this.config.LAMBDA_URL;
      this.speechRecognitionManager = new SpeechRecognitionManager(
        this.config,
        this.i18n,
        lambdaUrl
      );

      // Set up callbacks
      this.speechRecognitionManager.onTranscript((transcript) => {
        this.handleSpeechTranscript(transcript);
      });

      this.speechRecognitionManager.onError((error) => {
        this.handleSpeechError(error);
      });

      this.speechRecognitionManager.onStart(() => {
        this.updateMicrophoneButtonState(true);
      });

      this.speechRecognitionManager.onStop(() => {
        this.updateMicrophoneButtonState(false);
      });

    } catch (error) {
      errorLogger.log('SpeechRecognitionInit', error);
      // Silently fail - speech recognition is optional
    }
  }

  /**
   * Toggle speech recognition on/off
   */
  async toggleSpeechRecognition() {
    if (!this.speechRecognitionManager) {
      return;
    }

    if (this.speechRecognitionManager.isRecording) {
      await this.speechRecognitionManager.stopRecording();
    } else {
      await this.speechRecognitionManager.startRecording();
    }
  }

  /**
   * Handle speech transcript
   */
  handleSpeechTranscript(transcript) {
    if (!transcript) {
      return;
    }

    // Put transcript into chat input
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.value = transcript;

      // Optionally auto-send the message
      if (this.config.SPEECH_AUTO_SEND !== false) {
        this.handleUserInput();
      }
    }
  }

  /**
   * Handle speech recognition errors
   */
  handleSpeechError(error) {
    errorLogger.log('SpeechRecognitionError', error);

    // Show user-friendly error message
    let errorMessage = this.i18n.t('error.speechRecognitionMessage');

    // Provide specific error messages for common issues
    if (typeof error === 'string') {
      if (error.includes('not-allowed') || error.includes('permission')) {
        errorMessage = this.i18n.t('error.microphonePermissionMessage');
      } else if (error.includes('no-speech')) {
        errorMessage = this.i18n.t('error.noSpeechMessage');
      }
    }

    this.showError(
      this.i18n.t('error.speechRecognitionTitle'),
      errorMessage
    );
  }

  /**
   * Update microphone button visual state
   */
  updateMicrophoneButtonState(isRecording) {
    const micBtn = document.getElementById('micBtn');
    const micIcon = document.getElementById('micIcon');

    if (!micBtn) {
      return;
    }

    if (isRecording) {
      micBtn.classList.add('recording');
      if (micIcon) {
        micIcon.textContent = '⏹️'; // Stop icon
      }
    } else {
      micBtn.classList.remove('recording');
      if (micIcon) {
        micIcon.textContent = '🎤'; // Microphone icon
      }
    }
  }

  /**
   * Initialize text-to-speech
   */
  initializeTextToSpeech() {
    try {
      // Check if TTS is supported
      if (!window.speechSynthesis) {
        // Hide TTS button if not supported
        const ttsToggle = document.getElementById('tts-toggle');
        if (ttsToggle) {
          ttsToggle.style.display = 'none';
        }
        return;
      }

      // Initialize TTS manager
      const lambdaUrl = this.config.CLAUDE_API_PROXY || this.config.LAMBDA_URL;
      this.textToSpeechManager = new TextToSpeechManager(this.config, this.i18n, lambdaUrl);

      // Set up callbacks
      this.textToSpeechManager.onPreparing(() => {
        // When starting to prepare summary, show thinking display and update icons
        this.currentPreparingMessageId = this.currentSpeakingMessageId;
        this.updateMessageSpeakerIcons();

        // Show thinking display if available
        if (this.thinkingSimulator) {
          const thinkingDisplay = document.getElementById('thinkingDisplay');
          const thinkingSteps = document.getElementById('thinkingSteps');
          if (thinkingDisplay && thinkingSteps) {
            thinkingDisplay.style.display = 'block';
            // Start thinking with a TTS-specific message
            this.thinkingSimulator.startThinking('Generating speech summary...', thinkingSteps);
          }
        }
      });

      this.textToSpeechManager.onStart(() => {
        // When speech actually starts, hide thinking display and clear preparing state
        this.currentPreparingMessageId = null;
        this.updateAutoSpeakButtonState();
        this.updateMessageSpeakerIcons();

        // Hide thinking display if available
        if (this.thinkingSimulator) {
          const thinkingDisplay = document.getElementById('thinkingDisplay');
          if (thinkingDisplay) {
            thinkingDisplay.style.display = 'none';
          }
          this.thinkingSimulator.stopThinking();
        }
      });

      this.textToSpeechManager.onEnd(() => {
        this.currentPreparingMessageId = null;
        this.currentSpeakingMessageId = null;
        this.updateAutoSpeakButtonState();
        this.updateMessageSpeakerIcons();
      });

      this.textToSpeechManager.onError((error) => {
        errorLogger.log('TextToSpeechError', error);
        this.currentPreparingMessageId = null;
        this.currentSpeakingMessageId = null;
        this.updateAutoSpeakButtonState();
        this.updateMessageSpeakerIcons();

        // Hide thinking display if available
        if (this.thinkingSimulator) {
          const thinkingDisplay = document.getElementById('thinkingDisplay');
          if (thinkingDisplay) {
            thinkingDisplay.style.display = 'none';
          }
          this.thinkingSimulator.stopThinking();
        }
      });

      // Update button state
      this.updateAutoSpeakButtonState();

    } catch (error) {
      errorLogger.log('TextToSpeechInit', error);
      // Silently fail - TTS is optional
    }
  }

  /**
   * Toggle auto-speak mode
   */
  toggleTextToSpeech() {
    if (!this.textToSpeechManager) {
      return;
    }

    const enabled = this.textToSpeechManager.toggleAutoSpeak();
    this.updateAutoSpeakButtonState();

    // If disabling, stop current speech
    if (!enabled) {
      this.textToSpeechManager.stop();
      this.currentSpeakingMessageId = null;
    }
  }

  /**
   * Speak a message
   * @param {string} text - Text to speak
   * @param {string} messageId - Optional message ID for tracking
   */
  speakMessage(text, messageId = null) {
    if (!this.textToSpeechManager || !text) {
      return;
    }

    this.currentSpeakingMessageId = messageId;
    this.textToSpeechManager.speak(text);
    this.updateAutoSpeakButtonState();
  }

  /**
   * Stop speaking
   */
  stopSpeaking() {
    if (this.textToSpeechManager) {
      this.textToSpeechManager.stop();
      this.currentSpeakingMessageId = null;
      this.updateAutoSpeakButtonState();
    }
  }

  /**
   * Update auto-speak button visual state
   */
  updateAutoSpeakButtonState() {
    const ttsToggle = document.getElementById('tts-toggle');
    const ttsIcon = document.getElementById('tts-icon');

    if (!ttsToggle || !this.textToSpeechManager) {
      return;
    }

    const state = this.textToSpeechManager.getSpeakingState();

    // Update button class
    if (state.autoSpeakEnabled) {
      ttsToggle.classList.add('active');
    } else {
      ttsToggle.classList.remove('active');
    }

    // Update icon based on speaking state
    if (ttsIcon) {
      if (state.isSpeaking) {
        ttsIcon.textContent = '🔊'; // Speaking
        ttsToggle.classList.add('speaking');
      } else {
        ttsIcon.textContent = state.autoSpeakEnabled ? '🔊' : '🔇';
        ttsToggle.classList.remove('speaking');
      }
    }

    // Update all speaker icons on messages
    this.updateMessageSpeakerIcons();
  }

  /**
   * Update speaker icons on all messages
   */
  updateMessageSpeakerIcons() {
    const speakerIcons = document.querySelectorAll('.message-speaker-icon');
    speakerIcons.forEach(icon => {
      const messageId = icon.dataset.messageId;
      if (messageId === this.currentPreparingMessageId) {
        icon.textContent = '⏳'; // Loading icon when preparing summary
        icon.classList.add('preparing');
        icon.classList.remove('speaking');
      } else if (messageId === this.currentSpeakingMessageId) {
        icon.textContent = '⏸️'; // Pause icon when speaking
        icon.classList.add('speaking');
        icon.classList.remove('preparing');
      } else {
        icon.textContent = '🔊'; // Speaker icon
        icon.classList.remove('speaking', 'preparing');
      }
    });
  }

  /**
   * Remove event listeners
   */
  removeEventListeners() {
    // Abort all event listeners registered with AbortController
    this.abortController.abort();

    // Stop script observer if it exists
    if (this.scriptObserver) {
      this.scriptObserver.disconnect();
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.removeEventListeners();

    if (this.speechRecognitionManager) {
      this.speechRecognitionManager.cleanup();
    }

    if (this.textToSpeechManager) {
      this.textToSpeechManager.cleanup();
    }

    if (this.mapController) {
      await this.mapController.cleanup();
    }

    if (this.claudeClient) {
      await this.claudeClient.cleanup();
    }
  }
}
