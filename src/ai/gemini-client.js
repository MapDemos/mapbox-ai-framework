/**
 * Gemini Client
 * Handles communication with Gemini API and coordinates dual MCP architecture
 * - Rurubu MCP (client-side virtual server)
 * - Map Tools MCP (visualization library)
 */

export class GeminiClient {
  constructor(apiKey, rurubuMCP, mapController, i18n, config) {
    this.apiKey = apiKey;
    this.rurubuMCP = rurubuMCP;
    this.mapController = mapController;
    this.i18n = i18n;
    this.config = config;
    this.conversationHistory = [];
    this.systemPrompt = this.buildSystemPrompt();
  }

  /**
   * Build the system prompt for Gemini
   */
  buildSystemPrompt() {
    return `You are a knowledgeable and friendly Japan travel assistant. You help users discover and explore places across Japan, from bustling Tokyo neighborhoods to historic Kyoto temples.

You have access to TWO types of tools:

1. **Rurubu MCP Tools** (Japan-specific tourism):
   - search_rurubu_pois: Search Japanese attractions with photos, prices, and detailed information
   - get_jis_code: Convert location names to JIS municipality codes
   - Use these for: Japan tourism queries, detailed POI information with photos

2. **Map Visualization Tools**:
   - add_points_to_map: Display POI markers on the map
   - add_route_to_map: Show routes between locations
   - fit_map_to_bounds: Zoom map to show all results
   - clear_map_layers: Clear the map
   - Use these to visualize ALL geospatial data

IMPORTANT GUIDELINES:

**For Japan-specific queries:**
- Use Rurubu MCP for searching Japanese POIs (richer data with photos)
- Rurubu has 4 categories: eat (restaurants), buy (shopping), enjoy (entertainment), see (sightseeing)
- Rurubu provides photos, prices, hours, and detailed descriptions
- Example: "Find restaurants in Shibuya" → use search_rurubu_pois

**For visualization:**
- ALWAYS visualize results on the map using add_points_to_map
- Use fit_map_to_bounds after adding multiple points
- For day trips, combine points and routes for complete visualization

**Response style:**
- Be conversational and enthusiastic about Japan
- Provide cultural context and recommendations
- Mention the number of results found
- Highlight interesting POIs from the results
- Explain what's shown on the map`;
  }

  /**
   * Convert tools to Gemini format
   */
  convertToolsToGeminiFormat(tools) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }));
  }

  /**
   * Send message to Gemini
   */
  async sendMessage(userMessage, onProgress = null) {
    // Backup conversation state
    const conversationBackup = JSON.parse(JSON.stringify(this.conversationHistory));

    try {
      // Add user message
      this.conversationHistory.push({
        role: 'user',
        parts: [{ text: userMessage }]
      });

      // Collect tools from available sources
      const tools = [
        ...this.rurubuMCP.getToolsForClaude(),
        ...this.mapController.getToolsForClaude()
      ];

      if (this.config.DEBUG) {
      }

      if (onProgress) {
        onProgress(this.i18n.t('status.processing'));
      }

      // Call Gemini API directly (testing CORS)
      const geminiTools = this.convertToolsToGeminiFormat(tools);
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.GEMINI_MODEL}:generateContent?key=${this.apiKey}`;

      const requestBody = {
        contents: this.conversationHistory,
        systemInstruction: {
          parts: [{ text: this.systemPrompt }]
        },
        tools: [{
          functionDeclarations: geminiTools
        }],
        generationConfig: {
          temperature: this.config.TEMPERATURE,
          maxOutputTokens: this.config.MAX_TOKENS
        }
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      // Process response and handle tool calls
      return await this.processGeminiResponse(result, onProgress);

    } catch (error) {
      console.error('[Gemini] Error:', error);

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
   * Process Gemini's response and handle tool calls
   */
  async processGeminiResponse(geminiResponse, onProgress = null) {
    const candidate = geminiResponse.candidates?.[0];
    if (!candidate) {
      throw new Error('No response from Gemini');
    }

    const content = candidate.content;
    let textResponse = '';
    let functionCalls = [];

    // Extract text and function calls from response
    for (const part of content.parts) {
      if (part.text) {
        textResponse += part.text;
      }
      if (part.functionCall) {
        functionCalls.push(part.functionCall);
      }
    }

    // Add model response to history
    this.conversationHistory.push(content);

    // If there are function calls, execute them
    if (functionCalls.length > 0) {
      const functionResponses = [];

      for (const functionCall of functionCalls) {
        if (onProgress) {
          const toolName = functionCall.name;
          if (toolName.startsWith('search_rurubu')) {
            onProgress(this.i18n.t('status.callingRurubu'));
          } else if (toolName.includes('map') || toolName.includes('route')) {
            onProgress(this.i18n.t('status.visualizing'));
          } else {
            onProgress(this.i18n.t('status.callingMapbox'));
          }
        }

        const toolResult = await this.executeTool(functionCall.name, functionCall.args);

        functionResponses.push({
          name: functionCall.name,
          response: {
            name: functionCall.name,
            content: toolResult.content[0].text
          }
        });
      }

      // Add function responses to history
      this.conversationHistory.push({
        role: 'user',
        parts: functionResponses.map(fr => ({
          functionResponse: fr.response
        }))
      });

      // Get follow-up response from Gemini
      if (onProgress) {
        onProgress(this.i18n.t('status.processing'));
      }

      return await this.sendFollowUpRequest();
    }

    // No tool calls, return text response
    return {
      text: textResponse || 'No response generated.',
      toolsUsed: []
    };
  }

  /**
   * Send follow-up request after tool execution
   */
  async sendFollowUpRequest() {
    const tools = [
      ...this.rurubuMCP.getToolsForClaude(),
      ...this.mapController.getToolsForClaude()
    ];

    const geminiTools = this.convertToolsToGeminiFormat(tools);
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.GEMINI_MODEL}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents: this.conversationHistory,
      systemInstruction: {
        parts: [{ text: this.systemPrompt }]
      },
      tools: [{
        functionDeclarations: geminiTools
      }],
      generationConfig: {
        temperature: this.config.TEMPERATURE,
        maxOutputTokens: this.config.MAX_TOKENS
      }
    };

    const response = await fetch(apiUrl, {
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
    return await this.processGeminiResponse(result);
  }

  /**
   * Execute a tool from any of the three MCP sources
   */
  async executeTool(toolName, args) {
    try {
      // Check Rurubu MCP tools
      const rurubuTool = this.rurubuMCP.getToolDefinition(toolName);
      if (rurubuTool) {
        return await this.rurubuMCP.executeTool(toolName, args);
      }

      // Check Map Tools
      const mapTools = this.mapController.getToolsForClaude();
      const mapTool = mapTools.find(t => t.name === toolName);
      if (mapTool) {
        return await this.mapController.executeTool(toolName, args);
      }

      throw new Error(`Unknown tool: ${toolName}`);

    } catch (error) {
      console.error(`[Gemini] Tool execution error for ${toolName}:`, error);
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
}
