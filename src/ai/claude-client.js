/**
 * Claude Client
 * Handles communication with Claude API and coordinates MCP architecture
 * - Data Source MCPs (domain-specific data providers)
 * - Map Tools (visualization library)
 */

import { errorLogger } from '../core/error-logger.js';

export class ClaudeClient {
  constructor(options) {
    // Extract options with defaults
    const {
      apiKey,
      dataSources = [],           // Array of DataSourceBase instances
      mapController,
      i18n,
      config,
      app = null,
      systemPromptBuilder = null,  // Optional: custom system prompt function
      onDataCallback = null        // Generic callback: (dataSource, toolName, result) => void
    } = options;

    this.apiKey = apiKey;
    this.dataSources = Array.isArray(dataSources) ? dataSources : [dataSources].filter(Boolean);
    this.mapController = mapController;
    this.i18n = i18n;
    this.config = config;
    this.app = app;
    this.systemPromptBuilder = systemPromptBuilder;
    this.onDataCallback = onDataCallback;
    this.conversationHistory = [];

    // Token caching - separate Map to avoid polluting message objects sent to API
    this.messageTokenCache = new WeakMap(); // WeakMap allows garbage collection of old messages
    this._cachedSystemPromptTokens = undefined;
    this._lastSystemPrompt = undefined;

    // Context tracking
    this.userLocation = null; // User's current location
    this.mapView = null; // Current map view (center, zoom, bounds)

    this.systemPrompt = this.buildSystemPrompt();

    // Token management
    this.MAX_TOKENS = config.MAX_CONTEXT_TOKENS || 200000;
    this.PRUNE_THRESHOLD = config.PRUNE_THRESHOLD_TOKENS || 160000; // Start pruning at 80% capacity
    this.WARNING_THRESHOLD = config.WARNING_THRESHOLD_TOKENS || 140000; // Show warning at 70% capacity
    this.conversationSummary = null; // Store summary of pruned messages
  }

  /**
   * Build the system prompt for Claude
   */
  buildSystemPrompt(userLocation = null, mapView = null) {
    // If custom system prompt builder provided, use it
    if (this.systemPromptBuilder) {
      return this.systemPromptBuilder({
        userLocation: userLocation || this.userLocation,
        mapView: mapView || this.mapView,
        i18n: this.i18n,
        dataSources: this.dataSources,
        config: this.config
      });
    }

    // Otherwise, use default generic prompt
    return this.buildDefaultSystemPrompt(userLocation, mapView);
  }

  /**
   * Build default system prompt (generic, domain-agnostic)
   * This is used when no custom systemPromptBuilder is provided
   */
  buildDefaultSystemPrompt(userLocation = null, mapView = null) {
    // Get current language
    const currentLang = this.i18n.getCurrentLanguage();
    const langName = currentLang === 'ja' ? 'Japanese' : 'English';

    // Build location context
    let locationContext = '';
    if (userLocation) {
      const coords = `${userLocation.latitude.toFixed(6)}, ${userLocation.longitude.toFixed(6)}`;
      const placeName = userLocation.placeName || userLocation.name;
      if (placeName) {
        locationContext = `\n\nUSER LOCATION:\n- Current location: ${placeName}\n- Coordinates: ${coords}\n- When user asks "around me", "near me", "nearby", use this location as reference`;
      } else {
        locationContext = `\n\nUSER LOCATION:\n- Current location: ${coords}\n- When user asks "around me", "near me", "nearby", use this location as reference`;
      }
    }

    // Build map view context
    let mapViewContext = '';
    if (mapView) {
      const { center, zoom, placeName, name } = mapView;
      const coords = `${center.lat.toFixed(4)}°N, ${center.lng.toFixed(4)}°E`;
      if (placeName || name) {
        const location = placeName || name;
        mapViewContext = `Map view: ${location} (${coords}, zoom ${zoom.toFixed(1)})\n\n`;
      } else {
        mapViewContext = `Map view: ${coords} (zoom ${zoom.toFixed(1)})\n\n`;
      }
    }

    return `${mapViewContext}You are an AI assistant helping users explore locations and find places of interest.

YOUR APPROACH:
- Ask clarifying questions when needed
- Use available tools to search for relevant information
- Present findings clearly and accurately
- Respond in ${langName}${locationContext}

TOOLS AVAILABLE:
- Use search tools to find places and information
- Use map tools to visualize locations and routes
- Always verify data before presenting it to users

GUIDELINES:
- Ask for clarification if the user's request is vague
- Search for relevant information using the tools available
- Present only data-backed information
- Offer to adjust or provide more options based on user feedback`;
  }

  /**
   * Get all available tools from all sources
   */
  getAllTools() {
    const tools = [];

    // Collect from all data sources
    this.dataSources.forEach(dataSource => {
      if (dataSource && typeof dataSource.getToolsForClaude === 'function') {
        tools.push(...dataSource.getToolsForClaude());
      }
    });

    // Add map tools
    if (this.mapController && typeof this.mapController.getToolsForClaude === 'function') {
      tools.push(...this.mapController.getToolsForClaude());
    }

    // Add app tools (search history)
    if (this.app && typeof this.app.getSearchHistoryTools === 'function') {
      tools.push(...this.app.getSearchHistoryTools());
    }

    return tools;
  }

  /**
   * Update user location and rebuild system prompt
   */
  updateUserLocation(userLocation) {
    this.userLocation = userLocation;
    this.systemPrompt = this.buildSystemPrompt(this.userLocation, this.mapView);
  }

  /**
   * Update map view and rebuild system prompt
   */
  updateMapView(mapView) {
    this.mapView = mapView;
    this.systemPrompt = this.buildSystemPrompt(this.userLocation, this.mapView);
  }

  /**
   * Send message to Claude
   */
  async sendMessage(userMessage, onProgress = null, onStreamUpdate = null) {
    // Backup conversation state
    const conversationBackup = JSON.parse(JSON.stringify(this.conversationHistory));

    try {
      // Add user message
      this.conversationHistory.push({
        role: 'user',
        content: userMessage
      });

      // Check token usage and prune if necessary
      // DISABLED: Auto-pruning disabled - will wait for Claude API to return 400 error instead
      // const tokenUsage = this.getTokenUsage();
      //
      // if (tokenUsage.needsPruning) {
      //   if (onProgress) {
      //     onProgress(this.i18n.t('status.optimizing'));
      //   }
      //
      //   const pruneResult = await this.pruneConversation();
      //
      //   if (pruneResult.pruned) {
      //     console.log(`[Claude] Auto-pruned ${pruneResult.messagesPruned} messages, saved ${pruneResult.tokensSaved} tokens`);
      //     console.log(`[Claude] New token count: ${pruneResult.newTotal} (${Math.round((pruneResult.newTotal / this.MAX_TOKENS) * 100)}%)`);
      //
      //     // Optional: Add a subtle notification that pruning occurred
      //     // This helps users understand why older messages might not be in context
      //     if (onProgress) {
      //       onProgress(this.i18n.t('status.processing'));
      //     }
      //   }
      // }

      // Collect tools from available sources
      const tools = this.getAllTools();

      if (this.config.DEBUG) {
      }

      // Prepare request with streaming disabled
      const requestBody = {
        model: this.config.CLAUDE_MODEL,
        max_tokens: this.config.MAX_TOKENS,
        temperature: this.config.TEMPERATURE,
        system: this.systemPrompt,
        messages: this.conversationHistory,
        tools: tools,
        stream: false // Disable streaming to avoid 502 errors
      };

      if (onProgress) {
        onProgress(this.i18n.t('status.processing'));
      }

      // Call Claude API via proxy server with retry logic
      const apiEndpoint = this.config.CLAUDE_API_PROXY || 'http://localhost:3001/api/claude';
      const MAX_RETRIES = 3;
      const TIMEOUT_MS = 30000;

      let lastError;
      let result;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Create abort controller for timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

          const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            // Retry on 5xx errors or 429 (rate limit)
            if ((response.status >= 500 || response.status === 429) && attempt < MAX_RETRIES) {
              const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }

            const errorText = await response.text();
            throw new Error(`Claude API Error: ${response.status} - ${errorText}`);
          }

          result = await response.json();

          // Success - break retry loop
          lastError = null;
          break;
        } catch (error) {
          lastError = error;

          // If it's an abort error (timeout) or network error, retry
          if ((error.name === 'AbortError' || error.message.includes('fetch')) && attempt < MAX_RETRIES) {
            const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }

          // If max retries reached, throw the error
          if (attempt === MAX_RETRIES) {
            throw error;
          }
        }
      }

      // If we still have an error after all retries, throw it
      if (lastError) {
        throw lastError;
      }

      // Check if we got streaming chunks
      if (result.chunks && Array.isArray(result.chunks)) {
        return await this.processStreamingResponse(result.chunks, onProgress, onStreamUpdate);
      }

      // Fallback to non-streaming processing
      return await this.processClaudeResponse(result, onProgress);

    } catch (error) {
      console.error('[Claude] Error:', error);

      // Check if it's a token overflow error - re-throw to show error modal
      const errorMsg = error?.message || String(error) || '';
      const isTokenError = errorMsg.includes('400') ||
                          errorMsg.includes('token') ||
                          errorMsg.includes('too large') ||
                          errorMsg.includes('context length') ||
                          errorMsg.includes('invalid_request_error');

      if (isTokenError) {
        throw error; // Re-throw to trigger error modal
      }

      // Rollback conversation on error
      this.conversationHistory = conversationBackup;

      return {
        text: `${this.i18n.t('status.error')}: ${error.message}`,
        toolsUsed: [],
        isError: true
      };
    }
  }

  /**
   * Process streaming response chunks incrementally
   */
  async processStreamingResponse(chunks, onProgress = null, onStreamUpdate = null) {
    let assistantMessage = {
      role: 'assistant',
      content: []
    };

    let accumulatedText = '';
    let toolUses = [];
    let contentIndex = 0;

    // Process each chunk
    for (const chunk of chunks) {
      if (chunk.type === 'message_start') {
        // Initial message started
        continue;
      }

      if (chunk.type === 'content_block_start') {
        // New content block starting
        const content = chunk.content_block;

        if (content.type === 'text') {
          contentIndex = chunk.index;
          if (!assistantMessage.content[contentIndex]) {
            assistantMessage.content[contentIndex] = { type: 'text', text: '' };
          }
        } else if (content.type === 'thinking') {
          contentIndex = chunk.index;
          if (!assistantMessage.content[contentIndex]) {
            assistantMessage.content[contentIndex] = { type: 'thinking', thinking: '' };
          }
        } else if (content.type === 'tool_use') {
          contentIndex = chunk.index;
          toolUses.push(content);
          // Only store essential tool_use fields, initialize input as empty string for accumulation
          assistantMessage.content[contentIndex] = {
            type: 'tool_use',
            id: content.id,
            name: content.name,
            input: '' // Start with empty string, will be built from input_json_delta chunks
          };
        }
        continue;
      }

      if (chunk.type === 'content_block_delta') {
        // Incremental text update
        const delta = chunk.delta;

        if (delta.type === 'text_delta') {
          assistantMessage.content[contentIndex].text += delta.text;
          accumulatedText += delta.text;

          // Call streaming update callback
          if (onStreamUpdate) {
            onStreamUpdate(accumulatedText);
          }
        } else if (delta.type === 'input_json_delta') {
          // Tool input being built
          if (!assistantMessage.content[contentIndex].input) {
            assistantMessage.content[contentIndex].input = '';
          }
          assistantMessage.content[contentIndex].input += delta.partial_json;
        }
        continue;
      }

      if (chunk.type === 'content_block_stop') {
        // Content block finished
        continue;
      }

      if (chunk.type === 'message_delta') {
        // Message metadata update (stop_reason, etc.)
        continue;
      }

      if (chunk.type === 'message_stop') {
        // Message complete
        break;
      }
    }

    // Add assistant message to history
    // Note: Thinking blocks from streaming don't have proper structure (missing signature field)
    // so we filter them out from conversation history
    const messageForHistory = {
      role: 'assistant',
      content: assistantMessage.content
        .filter(block => block.type !== 'thinking') // Always filter out thinking blocks
        .map(block => {
          // Parse string inputs back to objects for tool_use blocks
          if (block.type === 'tool_use' && typeof block.input === 'string') {
            try {
              return {
                ...block,
                input: JSON.parse(block.input)
              };
            } catch (e) {
              console.error('[Claude] Failed to parse tool input for history:', e);
              return block;
            }
          }
          return block;
        })
    };
    this.conversationHistory.push(messageForHistory);

    // If we have tool calls, execute them
    if (toolUses.length > 0) {
      if (onProgress) {
        onProgress(this.i18n.t('status.callingTools'));
      }

      // Collect all tool calls first
      const toolCalls = assistantMessage.content
        .filter(content => content.type === 'tool_use')
        .map(content => {
          // Parse tool input if it's a string (from streaming chunks)
          let toolInput = content.input;
          if (typeof toolInput === 'string') {
            try {
              toolInput = JSON.parse(toolInput);
            } catch (e) {
              // Failed to parse tool input
            }
          }
          return { content, toolInput };
        });

      // Execute all tools in parallel
      const toolExecutionPromises = toolCalls.map(({ content, toolInput }) =>
        this.executeTool(content.name, toolInput)
      );

      const toolExecutionResults = await Promise.all(toolExecutionPromises);

      // Process results
      let toolResults = [];
      let truncatedToolResults = [];

      toolCalls.forEach(({ content }, index) => {
        const toolResult = toolExecutionResults[index];

        // Compress GeoJSON in tool result if it's a POI search (for follow-up request)
        const compressedResult = this.compressToolResult(content.name, toolResult);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: content.id,
          content: compressedResult.content
        });

        // Also keep truncated version for conversation history
        const truncatedResult = this.truncateToolResult(content.name, toolResult);
        truncatedToolResults.push({
          type: 'tool_result',
          tool_use_id: content.id,
          content: truncatedResult.content
        });
      });

      // Add TRUNCATED tool results to conversation history (to reduce payload for future requests)
      this.conversationHistory.push({
        role: 'user',
        content: truncatedToolResults
      });

      if (onProgress) {
        onProgress(this.i18n.t('status.processing'));
      }

      try {
        // Make follow-up request with FULL tool results (not from conversation history)
        // This allows Claude to see all data for the immediate follow-up without bloating the conversation
        const followUpResponse = await this.sendFollowUpRequest(toolResults);
        return followUpResponse;
      } catch (error) {
        console.error('[Claude] Follow-up request failed:', error);

        // Check if it's a token overflow error - re-throw to show error modal
        const errorMsg = error?.message || String(error) || '';
        const isTokenError = errorMsg.includes('400') ||
                            errorMsg.includes('token') ||
                            errorMsg.includes('too large') ||
                            errorMsg.includes('context length') ||
                            errorMsg.includes('invalid_request_error');

        if (isTokenError) {
          throw error; // Re-throw to trigger error modal
        }

        // For other errors, return partial response
        return {
          text: accumulatedText || 'I used some tools but encountered an error.',
          toolsUsed: toolResults.map(r => r.tool_use_id)
        };
      }
    }

    // No tool calls, return text response
    return {
      text: accumulatedText,
      toolsUsed: []
    };
  }

  /**
   * Process Claude's response and handle tool calls
   */
  async processClaudeResponse(claudeResponse, onProgress = null) {
    let assistantMessage = {
      role: 'assistant',
      content: []
    };

    let hasToolUse = false;

    // Separate text and tool use blocks
    const textBlocks = [];
    const toolUseBlocks = [];

    for (const content of claudeResponse.content) {
      if (content.type === 'text') {
        textBlocks.push(content);
      } else if (content.type === 'tool_use') {
        hasToolUse = true;
        toolUseBlocks.push(content);
      }
    }

    // Add text blocks to assistant message
    assistantMessage.content.push(...textBlocks);

    // Execute all tool calls in parallel
    let toolResults = [];
    let truncatedToolResults = [];

    if (hasToolUse && toolUseBlocks.length > 0) {
      if (onProgress) {
        onProgress(this.i18n.t('status.callingTools'));
      }

      // Execute all tools in parallel
      const toolExecutionPromises = toolUseBlocks.map(content =>
        this.executeTool(content.name, content.input)
      );

      const toolExecutionResults = await Promise.all(toolExecutionPromises);

      // Process results
      toolUseBlocks.forEach((content, index) => {
        const toolResult = toolExecutionResults[index];

        // Add tool use to assistant message
        assistantMessage.content.push(content);

        // Compress GeoJSON in tool result if it's a POI search (for follow-up request)
        const compressedResult = this.compressToolResult(content.name, toolResult);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: content.id,
          content: compressedResult.content
        });

        // Also keep truncated version for conversation history
        const truncatedResult = this.truncateToolResult(content.name, toolResult);
        truncatedToolResults.push({
          type: 'tool_result',
          tool_use_id: content.id,
          content: truncatedResult.content
        });
      });
    }

    // Add assistant message to history
    this.conversationHistory.push(assistantMessage);

    // If we have tool calls, add results and get follow-up
    if (hasToolUse && toolResults.length > 0) {
      // Add TRUNCATED tool results to conversation history (to reduce payload for future requests)
      this.conversationHistory.push({
        role: 'user',
        content: truncatedToolResults
      });

      if (onProgress) {
        onProgress(this.i18n.t('status.processing'));
      }

      try {
        // Make follow-up request with FULL tool results (not from conversation history)
        // This allows Claude to see all data for the immediate follow-up without bloating the conversation
        const followUpResponse = await this.sendFollowUpRequest(toolResults);
        return followUpResponse;
      } catch (error) {
        console.error('[Claude] Follow-up request failed:', error);

        // Check if it's a token overflow error - re-throw to show error modal
        const errorMsg = error?.message || String(error) || '';
        const isTokenError = errorMsg.includes('400') ||
                            errorMsg.includes('token') ||
                            errorMsg.includes('too large') ||
                            errorMsg.includes('context length') ||
                            errorMsg.includes('invalid_request_error');

        if (isTokenError) {
          throw error; // Re-throw to trigger error modal
        }

        // For other errors, return partial response
        return {
          text: assistantMessage.content.find(c => c.type === 'text')?.text ||
            'I used some tools but encountered an error processing the results.',
          toolsUsed: toolResults.map(r => r.tool_use_id)
        };
      }
    }

    // No tool calls, return text response
    return {
      text: assistantMessage.content.find(c => c.type === 'text')?.text || '',
      toolsUsed: []
    };
  }

  /**
   * Send follow-up request after tool execution
   * @param {Array} overrideToolResults - Optional: Use these tool results instead of last message in history (for same-turn full data)
   */
  async sendFollowUpRequest(overrideToolResults = null) {
    // Collect tools from all sources
    const tools = this.getAllTools();

    // Check token usage and prune if necessary before follow-up
    // DISABLED: Auto-pruning disabled - will wait for Claude API to return 400 error instead
    // const tokenUsage = this.getTokenUsage();
    //
    // if (tokenUsage.needsPruning) {
    //   await this.pruneConversation();
    // }

    // If override tool results provided, use conversation history with full results temporarily
    let messages = this.conversationHistory;
    if (overrideToolResults && overrideToolResults.length > 0) {
      // Clone conversation history and add/replace tool results
      messages = [...this.conversationHistory];
      if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        // Replace existing user message (update with uncompressed results)
        messages[messages.length - 1] = {
          role: 'user',
          content: overrideToolResults
        };
      } else {
        // Add new user message with tool results (last message was assistant with tool_use)
        messages.push({
          role: 'user',
          content: overrideToolResults
        });
      }
    }

    // Validate message structure before sending
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use');
        if (toolUseBlocks.length > 0) {
          // Next message must be user with tool_result
          const nextMsg = messages[i + 1];
          if (!nextMsg || nextMsg.role !== 'user') {
            console.error('[Claude] VALIDATION ERROR: tool_use without following user message', {
              messageIndex: i,
              toolUseIds: toolUseBlocks.map(b => b.id),
              nextMessage: nextMsg
            });
            console.error('[Claude] Full messages array:', JSON.stringify(messages, null, 2));
          } else if (Array.isArray(nextMsg.content)) {
            const toolResultIds = nextMsg.content
              .filter(b => b.type === 'tool_result')
              .map(b => b.tool_use_id);
            const toolUseIds = toolUseBlocks.map(b => b.id);
            const missingIds = toolUseIds.filter(id => !toolResultIds.includes(id));
            if (missingIds.length > 0) {
              console.error('[Claude] VALIDATION ERROR: tool_use without matching tool_result', {
                messageIndex: i,
                missingToolUseIds: missingIds,
                toolUseIds,
                toolResultIds
              });
              console.error('[Claude] Full messages array:', JSON.stringify(messages, null, 2));
            }
          }
        }
      }
    }

    const requestBody = {
      model: this.config.CLAUDE_MODEL,
      max_tokens: this.config.MAX_TOKENS,
      temperature: 1,
      system: this.systemPrompt,
      messages: messages,
      tools: tools,
      stream: false // Disable streaming for follow-up requests
      // Note: Thinking disabled for follow-up to avoid signature field requirement issues
    };

    const apiEndpoint = this.config.CLAUDE_API_PROXY || 'http://localhost:3001/api/claude';
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Follow-up request failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // Recursively process response (may include more tool calls)
    return await this.processClaudeResponse(result);
  }

  /**
   * Compress tool result by applying GeoJSON compression if applicable
   * Used for follow-up requests to reduce token usage while keeping POI data available
   */
  compressToolResult(toolName, result) {
    // Compress GeoJSON data in tool results
    if (result.content && result.content[0]) {
      try {
        const data = JSON.parse(result.content[0].text);
        if (data.geojson && data.geojson.features) {
          // Compress GeoJSON while keeping structure
          const compressed = {
            ...data,
            geojson: this.compressGeoJSON(data.geojson)
          };
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(compressed) // No formatting - save tokens
            }]
          };
        }
      } catch (e) {
        // If parsing fails, return original
        return result;
      }
    }
    return result;
  }

  /**
   * Compress GeoJSON data by removing verbose properties and reducing precision
   * Reduces token usage by ~60-70% while keeping user-relevant POI information
   *
   * Ultra-compressed format optimizations:
   * - Pipe-delimited string format (saves ~20-30% vs JSON arrays)
   * - String dictionary/interning (saves ~30-40% on repeated strings)
   * - Single-letter property keys (saves ~40% on property names)
   * - 6-decimal coordinate precision (saves ~10% while maintaining accuracy)
   * - Remove GeoJSON structure overhead (saves ~20%)
   * - No JSON formatting whitespace (saves ~15%)
   */
  compressGeoJSON(geojson) {
    if (!geojson || !geojson.features) return geojson;

    // STEP 1: Build string dictionary for repeated values
    // Collect unique strings for category, address, and sgenreName
    const stringSet = new Set();

    geojson.features.forEach(feature => {
      const p = feature.properties || {};
      if (p.category) stringSet.add(p.category);
      if (p.address) stringSet.add(p.address);
      if (p.sgenreName) stringSet.add(p.sgenreName);
    });

    // Convert set to array (dictionary)
    const dictionary = Array.from(stringSet);

    // Create reverse lookup map for O(1) index access
    const dictMap = new Map();
    dictionary.forEach((str, idx) => dictMap.set(str, idx));

    // Helper function to escape pipes and newlines in field values
    const escapeField = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      return str.replace(/\|/g, '\\|').replace(/\n/g, '\\n');
    };

    // Create pipe-delimited dictionary string (escape pipes in dict strings)
    const dictionaryString = dictionary.map(str => escapeField(str)).join('|');

    // STEP 2: Compress features using pipe-delimited format
    // Format: id|name|catIdx|lon|lat|rank|time|price|addrIdx|genreIdx|picCount
    const compressedLines = geojson.features.map(feature => {
      const p = feature.properties || {};
      const c = feature.geometry.coordinates;

      // Create pipe-delimited string for this POI
      // Indices: 0=id, 1=name, 2=catIdx, 3=lon, 4=lat, 5=rank, 6=time, 7=price, 8=addrIdx, 9=genreIdx, 10=pics
      const fields = [
        p.id,
        escapeField(p.name),
        p.category ? dictMap.get(p.category) : '', // Dictionary index (empty if null)
        Math.round(c[0] * 1000000) / 1000000, // 6 decimal precision (~11cm accuracy)
        Math.round(c[1] * 1000000) / 1000000, // 6 decimal precision
        p.rank || 0,
        escapeField(p.time || ''),
        escapeField(p.price || ''),
        p.address ? dictMap.get(p.address) : '', // Dictionary index
        p.sgenreName ? dictMap.get(p.sgenreName) : '', // Dictionary index
        (p.photos && p.photos.length) || 0
      ];

      return fields.join('|');
    });

    // Join all POIs with newlines
    const compressedString = compressedLines.join('\n');

    // Return pipe-delimited format with pipe-delimited dictionary
    return {
      t: 'p', // type: pipe-delimited
      dict: dictionaryString, // Pipe-delimited dictionary string
      f: compressedString // features as pipe-delimited string
    };
  }

  /**
   * Truncate large tool results to reduce payload size
   * Keeps essential info while removing verbose data
   */
  truncateToolResult(toolName, result) {
    // Truncate GeoJSON data to minimal summary
    if (result.content && result.content[0]) {
      try {
        const data = JSON.parse(result.content[0].text);
        if (data.geojson && data.geojson.features) {
          // Keep minimal summary - POI details available via map tools
          const truncated = {
            sid: data.search_id || 'unknown', // Abbreviate keys
            cat: data.category,
            loc: data.location,
            jis: data.jis_code,
            cnt: data.count,
            msg: `${data.count} ${data.category || 'POIs'} in ${data.location || 'area'}. Use get_poi_summary for details.`
          };
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(truncated) // No formatting - save tokens
            }]
          };
        }
      } catch (e) {
        // If parsing fails, return original
        return result;
      }
    }
    return result;
  }

  /**
   * Execute a tool from any data source or service
   */
  async executeTool(toolName, args) {
    try {
      // Check all data sources
      for (const dataSource of this.dataSources) {
        if (!dataSource) continue;

        // Check if this data source has this tool
        const hasToolMethod = typeof dataSource.getToolDefinition === 'function';
        const tool = hasToolMethod ? dataSource.getToolDefinition(toolName) : null;

        if (tool) {
          const result = await dataSource.executeTool(toolName, args);

          // Generic callback for any data source
          if (this.onDataCallback) {
            this.onDataCallback(dataSource, toolName, result, args);
          }

          return result;
        }
      }

      // Check Map Tools
      if (this.mapController) {
        const mapTools = this.mapController.getToolsForClaude();
        const mapTool = mapTools.find(t => t.name === toolName);
        if (mapTool) {
          return await this.mapController.executeTool(toolName, args);
        }
      }

      // Check Search History Tools
      if (this.app) {
        const searchHistoryTools = this.app.getSearchHistoryTools();
        const searchHistoryTool = searchHistoryTools.find(t => t.name === toolName);
        if (searchHistoryTool) {
          return await this.app.executeSearchHistoryTool(toolName, args);
        }
      }

      throw new Error(`Unknown tool: ${toolName}`);

    } catch (error) {
      console.error(`[Claude] Tool execution error for ${toolName}:`, error);
      return {
        content: [{
          type: 'text',
          text: `Error executing ${toolName}: ${error.message}`
        }],
        isError: true
      };
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return this.conversationHistory;
  }

  /**
   * Get conversation summary
   */
  getConversationSummary() {
    return {
      messageCount: this.conversationHistory.length,
      hasHistory: this.conversationHistory.length > 0
    };
  }

  /**
   * Estimate token count for text (extremely conservative approximation)
   * Uses multiple heuristics to account for:
   * - JSON structure overhead (brackets, quotes, commas)
   * - Tool definitions and complex nested data
   * - Japanese/multi-byte characters
   * - Encoding overhead
   *
   * Note: Previous formula (chars/3) underestimated by 21.5x, causing 208k token overflow.
   * This improved formula uses 1 char per token base + adjustments for better accuracy.
   */
  estimateTokens(text) {
    if (!text) return 0;

    // Ultra-conservative base: 1 char per token (safer than 1.5 chars/token)
    // This accounts for worst-case scenarios with heavy JSON and multi-byte chars
    let tokens = text.length;

    // Adjust for JSON structure complexity
    if (text.includes('{') || text.includes('[')) {
      // Count JSON structural elements for better estimation
      const jsonChars = (text.match(/[{}\[\],:"]/g) || []).length;
      // Each structural character tends to be a separate token
      tokens += jsonChars * 0.5; // Add 50% of structural chars
    }

    // Adjust for multi-byte characters (Japanese, etc.)
    const multiByte = text.match(/[\u3000-\u9FFF\uF900-\uFAFF]/g);
    if (multiByte) {
      // Japanese characters often tokenize to 2-3 tokens each
      tokens += multiByte.length * 1.5;
    }

    // Adjust for whitespace (typically separate tokens)
    const whitespace = (text.match(/\s+/g) || []).length;
    tokens += whitespace * 0.3;

    // Apply safety buffer of 20% for unpredictable overhead
    tokens = Math.ceil(tokens * 1.2);

    return tokens;
  }

  /**
   * Calculate and cache token count for a message
   * Uses cached value if available, otherwise calculates and caches
   * Uses WeakMap to avoid polluting message objects sent to API
   * @param {Object} msg - Message object
   * @returns {number} Token count
   */
  getMessageTokens(msg) {
    // Return cached value if available
    const cached = this.messageTokenCache.get(msg);
    if (cached !== undefined) {
      return cached;
    }

    // Calculate token count
    let tokens = 0;
    if (typeof msg.content === 'string') {
      tokens = this.estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      msg.content.forEach(block => {
        if (block.type === 'text') {
          tokens += this.estimateTokens(block.text);
        } else if (block.type === 'tool_use') {
          tokens += this.estimateTokens(JSON.stringify(block.input));
        } else if (block.type === 'tool_result') {
          tokens += this.estimateTokens(JSON.stringify(block.content));
        }
      });
    }

    // Cache the result in WeakMap
    this.messageTokenCache.set(msg, tokens);
    return tokens;
  }

  /**
   * Calculate total tokens in conversation
   * Uses cached token counts for efficiency
   */
  calculateTotalTokens() {
    // Cache system prompt tokens
    if (this._cachedSystemPromptTokens === undefined || this._lastSystemPrompt !== this.systemPrompt) {
      this._cachedSystemPromptTokens = this.estimateTokens(this.systemPrompt);
      this._lastSystemPrompt = this.systemPrompt;
    }
    let total = this._cachedSystemPromptTokens;

    // Add conversation history using cached tokens
    this.conversationHistory.forEach(msg => {
      total += this.getMessageTokens(msg);
    });

    return total;
  }

  /**
   * Prune old conversation messages to stay under token limit
   * @returns {Object} Pruning info: { pruned, messagesPruned, tokensSaved, newTotal }
   */
  async pruneConversation() {
    const currentTokens = this.calculateTotalTokens();

    if (currentTokens < this.PRUNE_THRESHOLD) {
      return { pruned: false, reason: 'Below threshold' };
    }

    errorLogger.info('Token Management', 'Auto-pruning triggered', {
      currentTokens,
      threshold: this.PRUNE_THRESHOLD,
      percentage: Math.round((currentTokens / this.MAX_TOKENS) * 100)
    });

    // Keep first 2 messages (initial context) and last N messages
    // Less aggressive pruning per instance, but prune earlier to prevent overflow
    const messagesToKeep = 8; // Keep more messages per prune
    const initialMessages = 2;

    if (this.conversationHistory.length <= initialMessages + messagesToKeep) {
      errorLogger.warn('Token Management', 'Cannot prune: too few messages', {
        messageCount: this.conversationHistory.length,
        requiredMin: initialMessages + messagesToKeep
      });
      return { pruned: false, reason: 'Too few messages to prune' };
    }

    const beforeCount = this.conversationHistory.length;

    // Find safe cut point that doesn't break tool_use/tool_result pairs
    // We need to keep complete message pairs: assistant (with tool_use) + user (with tool_result)
    let cutIndex = this.conversationHistory.length - messagesToKeep;

    // Keep searching backward for a safe cut point
    // A safe cut point is where recentMessages starts with:
    // - A user message WITHOUT tool_result, OR
    // - An assistant message WITHOUT tool_use
    while (cutIndex > initialMessages && cutIndex < this.conversationHistory.length) {
      const messageAtCut = this.conversationHistory[cutIndex];

      // Check if this is a safe cut point
      let isSafe = false;

      if (messageAtCut.role === 'user') {
        // Safe if user message has NO tool_result
        if (Array.isArray(messageAtCut.content)) {
          const hasToolResult = messageAtCut.content.some(block => block.type === 'tool_result');
          isSafe = !hasToolResult;
        } else {
          // String content (no tool_result)
          isSafe = true;
        }
      } else if (messageAtCut.role === 'assistant') {
        // Assistant messages are ALWAYS safe to start with
        // If it has tool_use, the next message (user with tool_result) will also be in recentMessages
        isSafe = true;
      }

      if (isSafe) {
        break; // Found safe cut point
      }

      // Not safe, move back by one message pair (user + assistant)
      cutIndex -= 2;
    }

    // Ensure we don't go below initialMessages
    if (cutIndex <= initialMessages) {
      // Couldn't find a safe cut point - skip pruning this time
      errorLogger.warn('Token Management', 'No safe cut point found, skipping pruning', {
        conversationLength: this.conversationHistory.length,
        initialMessages: initialMessages
      });
      return { pruned: false, reason: 'No safe cut point found' };
    }

    const prunedMessages = this.conversationHistory.slice(initialMessages, cutIndex);
    const recentMessages = this.conversationHistory.slice(cutIndex);

    // Create intelligent summary of pruned content
    const summary = this.createConversationSummary(prunedMessages);
    this.conversationSummary = summary;

    // Keep initial messages, add summary, keep recent messages
    this.conversationHistory = [
      ...this.conversationHistory.slice(0, initialMessages),
      {
        role: 'user',
        content: `[Previous conversation summary: ${summary}]`
      },
      ...recentMessages
    ];

    const afterCount = this.conversationHistory.length;
    const newTokens = this.calculateTotalTokens();
    const tokensSaved = currentTokens - newTokens;

    errorLogger.info('Token Management', 'Pruning completed', {
      messagesPruned: prunedMessages.length,
      beforeCount,
      afterCount,
      tokensSaved,
      newTotal: newTokens,
      newPercentage: Math.round((newTokens / this.MAX_TOKENS) * 100)
    });

    return {
      pruned: true,
      messagesPruned: prunedMessages.length,
      tokensSaved,
      newTotal: newTokens,
      summary
    };
  }

  /**
   * Create an intelligent summary of conversation messages
   * Preserves important context like locations searched, POIs found, and actions taken
   */
  createConversationSummary(messages) {
    const userQueries = [];
    const locations = new Set();
    const actions = new Set();
    const searches = []; // Track search results
    const toolsUsed = new Set();

    messages.forEach(msg => {
      // Process user messages
      if (msg.role === 'user' && typeof msg.content === 'string') {
        // Skip summary messages
        if (msg.content.startsWith('[Previous conversation summary:')) {
          return;
        }

        userQueries.push(msg.content);

        // Extract Japanese location names (カタカナ and 漢字)
        const japaneseLocations = msg.content.match(/[一-龠ぁ-ゔァ-ヴー々〆〤]{2,}/g);
        if (japaneseLocations) {
          japaneseLocations.forEach(loc => locations.add(loc));
        }

        // Extract English location names
        const englishLocations = msg.content.match(/(?:in|near|at|from|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g);
        if (englishLocations) {
          englishLocations.forEach(match => {
            const location = match.replace(/(?:in|near|at|from|to)\s+/, '');
            locations.add(location);
          });
        }

        // Extract actions
        if (msg.content.match(/探して|検索|見つけ|find|show|search|get/i)) actions.add('search');
        if (msg.content.match(/ルート|道順|route|direction|navigate|go/i)) actions.add('routing');
        if (msg.content.match(/隠す|消す|hide|clear|remove/i)) actions.add('manage');
        if (msg.content.match(/おすすめ|人気|recommend|popular/i)) actions.add('recommendations');
      }

      // Process assistant messages with tool use
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        msg.content.forEach(block => {
          if (block.type === 'tool_use') {
            toolsUsed.add(block.name);

            // Track searches
            if (block.name === 'search_pois_by_jis_code' || block.name === 'search_pois_by_location') {
              const location = block.input?.location || 'unknown';
              const category = block.input?.category || 'unknown';
              searches.push(`${category} in ${location}`);
            }
          }

          // Extract POI counts from text responses
          if (block.type === 'text') {
            const countMatch = block.text.match(/(\d+)件|found (\d+)|showing (\d+)/i);
            if (countMatch) {
              const count = countMatch[1] || countMatch[2] || countMatch[3];
              if (searches.length > 0) {
                searches[searches.length - 1] += ` (${count} POIs)`;
              }
            }
          }
        });
      }
    });

    // Build comprehensive summary
    const parts = [];

    if (userQueries.length > 0) {
      parts.push(`${userQueries.length} questions asked`);
    }

    if (locations.size > 0) {
      const locationList = Array.from(locations).slice(0, 5).join(', ');
      parts.push(`Locations: ${locationList}`);
    }

    if (searches.length > 0) {
      const searchSummary = searches.slice(0, 3).join('; ');
      parts.push(`Searches: ${searchSummary}`);
    }

    if (actions.size > 0) {
      parts.push(`Actions: ${Array.from(actions).join(', ')}`);
    }

    if (toolsUsed.size > 0) {
      parts.push(`Tools used: ${Array.from(toolsUsed).slice(0, 5).join(', ')}`);
    }

    const summary = parts.join(' | ');
    return summary || 'Previous conversation about Japan travel';
  }

  /**
   * Get token usage info using cached calculations
   */
  getTokenUsage() {
    // Use cached system prompt tokens
    if (this._cachedSystemPromptTokens === undefined || this._lastSystemPrompt !== this.systemPrompt) {
      this._cachedSystemPromptTokens = this.estimateTokens(this.systemPrompt);
      this._lastSystemPrompt = this.systemPrompt;
    }
    const systemPromptTokens = this._cachedSystemPromptTokens;

    // Use cached message tokens
    let conversationTokens = 0;
    this.conversationHistory.forEach(msg => {
      conversationTokens += this.getMessageTokens(msg);
    });

    // Estimate tools array size (not included in request but adds overhead)
    // Tools are sent with every request and can be 20-40k tokens
    const tools = this.getAllTools();
    const toolsTokens = this.estimateTokens(JSON.stringify(tools));

    const total = systemPromptTokens + conversationTokens + toolsTokens;
    const percentage = (total / this.MAX_TOKENS) * 100;
    const remaining = this.MAX_TOKENS - total;

    return {
      total,
      systemPrompt: systemPromptTokens,
      conversationHistory: conversationTokens,
      tools: toolsTokens,
      max: this.MAX_TOKENS,
      percentage: Math.round(percentage),
      remaining,
      needsPruning: total >= this.PRUNE_THRESHOLD,
      showWarning: total >= this.WARNING_THRESHOLD
    };
  }
}
