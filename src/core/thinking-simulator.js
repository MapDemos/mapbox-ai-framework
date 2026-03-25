/**
 * Thinking Simulator - Claude Code style status messages
 * Shows single-line cycling status messages until stopped
 *
 * This is the framework version - domain-agnostic message engine.
 * Subclass or provide a MessageProvider for domain-specific messages.
 */

export class ThinkingSimulator {
  constructor(i18n = null, messageProvider = null) {
    this.i18n = i18n;
    this.messageProvider = messageProvider || new DefaultMessageProvider();
    this.messages = [];
    this.currentIndex = 0;
    this.intervalId = null;
    this.containerElement = null;
    this.overlayStatusElement = null; // Optional overlay status element
    this.startTime = null;
    this.timerIntervalId = null;
  }

  /**
   * Check if current language is Japanese
   */
  isJapanese() {
    return this.i18n && this.i18n.getCurrentLanguage() === 'ja';
  }

  /**
   * Generate contextual status messages based on question
   * Delegates to message provider for domain-specific messages
   */
  generateMessages(question) {
    const lowerQuestion = question.toLowerCase();
    const context = {
      question: lowerQuestion,
      location: this.extractLocation(lowerQuestion),
      category: this.extractCategory(lowerQuestion),
      action: this.extractAction(lowerQuestion),
      isJapanese: this.isJapanese()
    };

    return this.messageProvider.generateMessages(context);
  }

  /**
   * Extract location from question
   * Delegates to message provider for domain-specific location mapping
   */
  extractLocation(question) {
    return this.messageProvider.extractLocation(question);
  }

  /**
   * Extract category from question
   * Delegates to message provider for domain-specific categories
   */
  extractCategory(question) {
    return this.messageProvider.extractCategory(question);
  }

  /**
   * Extract action from question
   * Common across domains, but can be overridden
   */
  extractAction(question) {
    if (question.match(/plan|itinerary|schedule|organize|プラン|旅程|スケジュール|計画|予定/)) {
      return 'plan';
    }
    if (question.match(/find|search|show|look for|探す|検索|見つける|教えて|見せて/)) {
      return 'find';
    }
    if (question.match(/recommend|suggest|おすすめ|推薦|提案/)) {
      return 'recommend';
    }

    return 'find';
  }

  /**
   * Start cycling through status messages
   * @param {string} question - The user's question
   * @param {HTMLElement} containerElement - Main thinking display container
   * @param {HTMLElement} overlayStatusElement - Optional overlay status element
   */
  startThinking(question, containerElement, overlayStatusElement = null) {
    this.containerElement = containerElement;
    this.overlayStatusElement = overlayStatusElement;
    this.messages = this.shuffleArray(this.generateMessages(question));
    this.currentIndex = 0;
    this.startTime = Date.now();

    // Clear container and create status line with timer
    containerElement.innerHTML = `
      <div class="thinking-status-line">
        <span class="thinking-status"></span>
        <span class="thinking-timer">0s</span>
      </div>
    `;
    const statusElement = containerElement.querySelector('.thinking-status');

    // Show first message immediately
    this.showMessage(statusElement);

    // Update timer every second
    this.timerIntervalId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const timerElement = containerElement.querySelector('.thinking-timer');
      if (timerElement) {
        timerElement.textContent = `${elapsed}s`;
      }

      // Also update overlay timer if present
      if (this.overlayStatusElement) {
        const overlayTimerElement = document.getElementById('thinkingOverlayTimer');
        if (overlayTimerElement) {
          overlayTimerElement.textContent = `${elapsed}s`;
        }
      }
    }, 1000);

    // Cycle through messages every 3 seconds
    this.intervalId = setInterval(() => {
      // Pick a random message (not the current one)
      let newIndex;
      do {
        newIndex = Math.floor(Math.random() * this.messages.length);
      } while (newIndex === this.currentIndex && this.messages.length > 1);

      this.currentIndex = newIndex;
      this.showMessage(statusElement);
    }, 3000);
  }

  /**
   * Shuffle array (Fisher-Yates algorithm)
   */
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Display current message
   */
  showMessage(statusElement) {
    const message = this.messages[this.currentIndex];
    statusElement.textContent = message;

    // Trigger fade animation
    statusElement.style.animation = 'none';
    setTimeout(() => {
      statusElement.style.animation = 'thinkingFade 0.3s ease-in-out';
    }, 10);

    // Also update overlay status if present
    if (this.overlayStatusElement) {
      this.overlayStatusElement.textContent = message;
    }
  }

  /**
   * Stop cycling messages
   */
  stopThinking() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.timerIntervalId) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    this.messages = [];
    this.currentIndex = 0;
    this.containerElement = null;
    this.startTime = null;
  }
}

/**
 * Default Message Provider
 * Provides generic, domain-agnostic thinking messages
 */
export class DefaultMessageProvider {
  /**
   * Extract location from question
   * Returns null - no default locations
   */
  extractLocation(question) {
    return null;
  }

  /**
   * Extract category from question
   * Returns generic category
   */
  extractCategory(question) {
    if (question.match(/restaurant|food|eat|dining|cuisine/)) {
      return 'dining';
    }
    if (question.match(/shop|shopping|store|buy|mall/)) {
      return 'shopping';
    }
    if (question.match(/park|garden|nature|outdoor/)) {
      return 'outdoor';
    }
    if (question.match(/hotel|accommodation|stay/)) {
      return 'accommodation';
    }

    return 'places';
  }

  /**
   * Generate thinking messages
   * Provides generic messages that work for any domain
   */
  generateMessages({ question, location, category, action, isJapanese }) {
    const messages = [];

    // Base thinking messages (10 variations)
    if (isJapanese) {
      messages.push('🤔 考え中...');
      messages.push('💭 検討中...');
      messages.push('🧠 処理中...');
      messages.push('📖 リクエストを分析中...');
      messages.push('🔍 クエリを理解中...');
      messages.push('💡 プランを作成中...');
      messages.push('⚙️ 検索を初期化中...');
      messages.push('🎯 詳細に集中中...');
      messages.push('📋 リクエストを解析中...');
      messages.push('🔎 クエリを調査中...');
    } else {
      messages.push('🤔 thinking...');
      messages.push('💭 pondering...');
      messages.push('🧠 processing...');
      messages.push('📖 analyzing your request...');
      messages.push('🔍 understanding query...');
      messages.push('💡 formulating plan...');
      messages.push('⚙️ initializing search...');
      messages.push('🎯 focusing on details...');
      messages.push('📋 parsing request...');
      messages.push('🔎 examining query...');
    }

    // Location-specific messages (if location detected)
    if (location) {
      if (isJapanese) {
        messages.push(`🗺️ ${location}を探索中...`);
        messages.push(`🔍 ${location}エリアを検索中...`);
        messages.push(`📍 ${location}のスポットを検索中...`);
      } else {
        messages.push(`🗺️ exploring ${location}...`);
        messages.push(`🔍 searching ${location} area...`);
        messages.push(`📍 locating spots in ${location}...`);
      }
    }

    // Category-specific messages
    if (category === 'dining') {
      if (isJapanese) {
        messages.push('🍜 飲食店を探索中...');
        messages.push('🍽️ レストランを閲覧中...');
        messages.push('⭐ 評価を確認中...');
      } else {
        messages.push('🍜 hunting for food spots...');
        messages.push('🍽️ browsing restaurants...');
        messages.push('⭐ checking ratings...');
      }
    } else if (category === 'shopping') {
      if (isJapanese) {
        messages.push('🛍️ ショッピングスポットを閲覧中...');
        messages.push('🏬 店舗をスキャン中...');
      } else {
        messages.push('🛍️ browsing shopping spots...');
        messages.push('🏬 scanning stores...');
      }
    } else if (category === 'outdoor') {
      if (isJapanese) {
        messages.push('🌳 自然スポットを検索中...');
        messages.push('🏞️ 公園を発見中...');
      } else {
        messages.push('🌳 finding nature spots...');
        messages.push('🏞️ discovering parks...');
      }
    } else {
      if (isJapanese) {
        messages.push('📍 場所を検索中...');
        messages.push('✨ オプションを収集中...');
        messages.push('🔍 可能性を探索中...');
      } else {
        messages.push('📍 searching locations...');
        messages.push('✨ gathering options...');
        messages.push('🔍 exploring possibilities...');
      }
    }

    // Action-specific messages
    if (action === 'plan') {
      if (isJapanese) {
        messages.push('🗓️ 旅程を計画中...');
        messages.push('🚃 ルートを計算中...');
        messages.push('⏱️ 時間を見積もり中...');
      } else {
        messages.push('🗓️ planning itinerary...');
        messages.push('🚃 calculating routes...');
        messages.push('⏱️ estimating times...');
      }
    }

    // General processing messages (20 variations)
    if (isJapanese) {
      messages.push('🔧 データを調整中...');
      messages.push('⚡ 結果を処理中...');
      messages.push('📊 オプションを評価中...');
      messages.push('🎯 おすすめを準備中...');
      messages.push('📍 地図にプロット中...');
      messages.push('🔨 提案を作成中...');
      messages.push('✨ 結果を磨き上げ中...');
      messages.push('🎨 調査結果を整理中...');
      messages.push('📝 情報を編集中...');
      messages.push('🔍 詳細を確認中...');
      messages.push('⚙️ データを組み立て中...');
      messages.push('🎯 最適なマッチを検索中...');
      messages.push('✅ 選択を検証中...');
      messages.push('🌟 お気に入りを強調中...');
      messages.push('🏆 トップピックを選択中...');
      messages.push('📈 品質別に並べ替え中...');
      messages.push('🎨 コレクションをキュレート中...');
      messages.push('💎 宝石を発見中...');
      messages.push('🔬 候補を検査中...');
      messages.push('✨ 選択を最終化中...');
    } else {
      messages.push('🔧 tinkering with data...');
      messages.push('⚡ processing results...');
      messages.push('📊 evaluating options...');
      messages.push('🎯 preparing recommendations...');
      messages.push('📍 plotting on map...');
      messages.push('🔨 crafting suggestions...');
      messages.push('✨ polishing results...');
      messages.push('🎨 organizing findings...');
      messages.push('📝 compiling information...');
      messages.push('🔍 verifying details...');
      messages.push('⚙️ assembling data...');
      messages.push('🎯 targeting best matches...');
      messages.push('✅ validating choices...');
      messages.push('🌟 highlighting favorites...');
      messages.push('🏆 selecting top picks...');
      messages.push('📈 sorting by quality...');
      messages.push('🎨 curating collection...');
      messages.push('💎 finding gems...');
      messages.push('🔬 examining candidates...');
      messages.push('✨ finalizing selections...');
    }

    return messages;
  }
}
