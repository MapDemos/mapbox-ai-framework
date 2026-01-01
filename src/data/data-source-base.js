/**
 * DataSourceBase - Abstract base class for domain-specific MCP clients
 *
 * This class provides the standard interface that all domain data sources must implement.
 * It follows the Model Context Protocol (MCP) pattern, providing tools that AI can use
 * to search and retrieve domain-specific data.
 *
 * Usage:
 * 1. Extend this class for your domain (e.g., RealEstateMCP, RideHailingMCP)
 * 2. Implement the required methods: initialize(), listTools(), executeTool()
 * 3. Return data in standardized format (GeoJSON for map visualization)
 *
 * Example:
 * ```javascript
 * export class RealEstateMCP extends DataSourceBase {
 *   async initialize() {
 *     this.listings = await fetch('./data/listings.json').then(r => r.json());
 *   }
 *
 *   listTools() {
 *     return [{
 *       name: 'search_properties',
 *       description: 'Search real estate properties...',
 *       inputSchema: { ... }
 *     }];
 *   }
 *
 *   async executeTool(toolName, args) {
 *     if (toolName === 'search_properties') {
 *       return await this.searchProperties(args);
 *     }
 *   }
 * }
 * ```
 */

export class DataSourceBase {
  /**
   * @param {Object} config - Application configuration
   * @param {Object} app - Reference to main application (for accessing shared state)
   */
  constructor(config, app = null) {
    this.config = config;
    this.app = app;

    // Get base path for deployed environment (e.g., /demo-name/)
    this.basePath = import.meta.env?.BASE_URL || '/';
  }

  /**
   * Initialize the data source
   * Load data files, connect to APIs, etc.
   *
   * @returns {Promise<boolean>} True if initialization successful
   * @throws {Error} If initialization fails
   */
  async initialize() {
    throw new Error('DataSourceBase.initialize() must be implemented by subclass');
  }

  /**
   * List available tools in MCP format
   *
   * Each tool must have:
   * - name: Unique tool identifier (e.g., 'search_properties')
   * - description: What the tool does (shown to AI)
   * - inputSchema: JSON Schema defining parameters
   *
   * @returns {Array<Object>} Array of tool definitions
   *
   * Example:
   * ```javascript
   * listTools() {
   *   return [{
   *     name: 'search_items',
   *     description: 'Search for items by location and category',
   *     inputSchema: {
   *       type: 'object',
   *       properties: {
   *         location: { type: 'string', description: 'City or area' },
   *         category: { type: 'string', enum: ['type1', 'type2'] }
   *       },
   *       required: ['location']
   *     }
   *   }];
   * }
   * ```
   */
  listTools() {
    throw new Error('DataSourceBase.listTools() must be implemented by subclass');
  }

  /**
   * Execute a tool with given arguments
   *
   * @param {string} toolName - Name of tool to execute
   * @param {Object} args - Tool arguments (validated against inputSchema)
   * @returns {Promise<Object>} Tool result in MCP format
   *
   * Result format:
   * ```javascript
   * {
   *   content: [{
   *     type: 'text',
   *     text: JSON.stringify({
   *       count: 42,
   *       geojson: { type: 'FeatureCollection', features: [...] },
   *       summary: 'Found 42 items'
   *     })
   *   }]
   * }
   * ```
   */
  async executeTool(toolName, args) {
    throw new Error('DataSourceBase.executeTool() must be implemented by subclass');
  }

  /**
   * Get tool definition by name
   * @param {string} toolName - Tool name
   * @returns {Object|undefined} Tool definition
   */
  getToolDefinition(toolName) {
    const tools = this.listTools();
    return tools.find(t => t.name === toolName);
  }

  /**
   * Convert tools to Claude API format
   * Maps MCP tool definitions to Claude's expected format
   *
   * @returns {Array<Object>} Tools in Claude format
   */
  getToolsForClaude() {
    return this.listTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
  }

  /**
   * Helper: Parse CSV text to array of objects
   * Handles BOM, empty lines, and trims values
   *
   * @param {string} text - CSV text content
   * @returns {Array<Object>} Array of row objects
   */
  parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    // Remove BOM if present and get headers
    const headers = lines[0].replace(/^\uFEFF/, '').split(',');
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = line.split(',');
      const row = {};
      headers.forEach((header, index) => {
        row[header.trim()] = values[index]?.trim() || '';
      });
      data.push(row);
    }

    return data;
  }

  /**
   * Helper: Convert results to GeoJSON format
   * Standard format for displaying results on map
   *
   * @param {Array<Object>} results - Array of result objects
   * @param {Function} featureMapper - Function to map result to GeoJSON feature
   * @returns {Object} GeoJSON FeatureCollection
   *
   * Example:
   * ```javascript
   * const geojson = this.toGeoJSON(properties, (prop) => ({
   *   geometry: {
   *     type: 'Point',
   *     coordinates: [prop.longitude, prop.latitude]
   *   },
   *   properties: {
   *     id: prop.id,
   *     name: prop.address,
   *     price: `$${prop.price.toLocaleString()}`,
   *     summary: `${prop.bedrooms}BR/${prop.bathrooms}BA`
   *   }
   * }));
   * ```
   */
  toGeoJSON(results, featureMapper) {
    return {
      type: 'FeatureCollection',
      features: results.map((result, index) => {
        const mapped = featureMapper(result, index);
        return {
          type: 'Feature',
          id: mapped.id || index,
          geometry: mapped.geometry,
          properties: mapped.properties
        };
      })
    };
  }

  /**
   * Helper: Create MCP tool result
   * Standard format for returning data to AI
   *
   * @param {Object} data - Result data to return
   * @returns {Object} MCP-formatted result
   */
  createToolResult(data) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(data)
      }]
    };
  }

  /**
   * Helper: Create error result
   * Standard format for returning errors to AI
   *
   * @param {string} message - Error message
   * @param {Object} details - Additional error details
   * @returns {Object} MCP-formatted error result
   */
  createErrorResult(message, details = {}) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: message,
          ...details
        })
      }],
      isError: true
    };
  }
}
