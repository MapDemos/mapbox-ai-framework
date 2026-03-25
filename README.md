# Mapbox AI Framework

Build AI-powered map applications in minutes. Combines Mapbox GL JS with Claude/Gemini AI for intelligent, conversational map experiences.

## Features

- 🤖 **AI Integration**: Pre-built Claude and Gemini clients with token management
- 🗺️ **Map Tools**: 15+ Mapbox GL JS utilities (geocoding, directions, isochrones, travel time matrix)
- 🔌 **MCP Pattern**: Model Context Protocol for connecting AI to data sources
- 🛠️ **Base Classes**: Extend `DataSourceBase` and `BaseApp` for your domain
- 🌐 **Lambda Proxy**: Secure AI API proxy with rate limiting and CORS
- 🔒 **Production Ready**: XSS protection, input sanitization, error handling, token management
- 📦 **Configurable**: Extensive configuration options with sensible defaults
- 🌍 **I18n Support**: Built-in internationalization with language switching
- 🎤 **Speech Recognition**: Voice input with automatic silence detection, Web Speech API and Google Cloud Speech-to-Text (optimized for LG webOS TVs)
- 🔊 **Text-to-Speech**: AI response playback with hybrid TTS (Web Speech API or Google Cloud WaveNet/Neural2), auto-speak mode, and per-message controls

## Installation

This package is published to **GitHub Packages** (private registry).

### 1. Configure npm for GitHub Packages

Create or update `.npmrc` in your project root:

```bash
echo "@mapdemos:registry=https://npm.pkg.github.com" > .npmrc
```

### 2. Authenticate (One-time setup)

```bash
# Login to GitHub Packages
npm login --scope=@mapdemos --registry=https://npm.pkg.github.com

# Credentials:
# Username: your-github-username
# Password: <your-github-personal-access-token>
# Email: your-email
```

**GitHub Personal Access Token:**
- Go to: https://github.com/settings/tokens/new
- Scopes needed: `read:packages`, `write:packages` (if publishing)
- Save token securely

### 3. Install the Package

```bash
npm install @mapdemos/ai-framework mapbox-gl
```

## Quick Start

### 1. Setup Your Project

Your `.npmrc` should contain:
```
@mapdemos:registry=https://npm.pkg.github.com
```

### 2. Create Your Data Source

```javascript
// modules/my-data-mcp.js
import { DataSourceBase } from '@mapdemos/ai-framework/data';

export class MyDataMCP extends DataSourceBase {
  async initialize() {
    // Load your data (CSV, JSON, API)
    this.items = await fetch('./data/items.json').then(r => r.json());
  }

  listTools() {
    return [{
      name: 'search_items',
      description: 'Search for items by location and category',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' },
          category: { type: 'string' }
        },
        required: ['location']
      }
    }];
  }

  async executeTool(toolName, args) {
    if (toolName === 'search_items') {
      const results = this.items.filter(item =>
        item.city.toLowerCase() === args.location.toLowerCase()
      );

      const geojson = this.toGeoJSON(results, (item) => ({
        geometry: {
          type: 'Point',
          coordinates: [item.longitude, item.latitude]
        },
        properties: {
          id: item.id,
          name: item.name,
          category: item.category
        }
      }));

      return this.createToolResult({
        count: results.length,
        geojson,
        summary: `Found ${results.length} items`
      });
    }
  }
}
```

### 3. Create Your App

```javascript
// index.js
import { BaseApp } from '@mapdemos/ai-framework';
import { MyDataMCP } from './modules/my-data-mcp.js';
import { CONFIG } from './config.js';
import { translations } from './translations.js';

class MyApp extends BaseApp {
  // Required: Provide your data sources
  async getDataSources() {
    const dataMCP = new MyDataMCP(this.config, this);
    await dataMCP.initialize();
    return [dataMCP];
  }

  // Optional: Customize AI system prompt
  getSystemPromptBuilder() {
    return (userLocation, mapView) => `You are an AI assistant helping users find items.

    Use the search_items tool to search our database.
    Always ask for location if not provided.
    Present 3-5 top recommendations.

    ${userLocation ? `User is near: ${userLocation.city || userLocation.place}` : ''}
    ${mapView ? `Map showing: ${mapView.center.join(', ')} at zoom ${mapView.zoom}` : ''}`;
  }

  // Optional: Handle tool execution results
  getDataCallback() {
    return (toolName, result) => {
      console.log(`Tool ${toolName} executed:`, result);
      // Custom handling of tool results
    };
  }
}

const app = new MyApp(CONFIG, translations);
app.initialize();
```

### 4. Configure

```javascript
// config.js
export const CONFIG = {
  // Required
  MAPBOX_ACCESS_TOKEN: 'pk.ey...',
  CLAUDE_API_PROXY: 'https://your-lambda.aws.com',

  // AI Configuration
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  AI_PROVIDER: 'claude', // or 'gemini'
  TEMPERATURE: 0.7,

  // Map Configuration
  DEFAULT_MAP_CENTER: [-122.4194, 37.7749],
  DEFAULT_MAP_ZOOM: 12,
  AUTO_SHOW_USER_LOCATION: true,

  // Token Management
  MAX_CONTEXT_TOKENS: 200000,
  PRUNE_THRESHOLD_TOKENS: 160000,
  WARNING_THRESHOLD_TOKENS: 140000,

  // Rate Limiting
  REQUEST_RATE_LIMIT_MS: 1000,
  RATE_LIMIT_BURST_CAPACITY: 5,
  RATE_LIMIT_REFILL_RATE: 1, // tokens per second

  // Input Validation
  MAX_INPUT_LENGTH: 2000,
  MAX_CHAT_HISTORY: 100,

  // Debugging
  DEBUG: false
};
```

That's it! You now have a working AI + map application.

## Architecture

### Framework Structure

```
framework/
├── src/
│   ├── core/           # Error handling, utils
│   ├── ai/             # Claude/Gemini clients
│   ├── map/            # Mapbox utilities
│   ├── data/           # DataSourceBase
│   ├── app/            # AppBase
│   └── lambda/         # AI proxy handler
```

### Your Demo Structure

```
your-demo/
├── index.js            # App initialization (~30 lines)
├── config.js           # API keys & settings
├── modules/
│   └── domain-mcp.js   # Your data source (~150 lines)
├── prompts/
│   └── system.js       # AI system prompt
└── data/
    └── items.json      # Your domain data
```

**Total code you write: ~200 lines**

**Framework handles: ~4,500 lines of production code**

## Core Concepts

### 1. DataSourceBase

Abstract base class for your domain data. Implements the MCP (Model Context Protocol) pattern.

**Required Methods:**
- `initialize()` - Load data, connect to APIs
- `listTools()` - Define tools for AI to use
- `executeTool(toolName, args)` - Execute tool, return results

**Helper Methods:**
- `parseCSV(text)` - Parse CSV files
- `toGeoJSON(results, mapper)` - Convert to GeoJSON
- `createToolResult(data)` - Format MCP result
- `createErrorResult(message)` - Format error

### 2. BaseApp

Main application orchestration. Handles:
- Map initialization with MapController
- AI client setup (Claude/Gemini)
- Event handlers and UI updates
- Token management with auto-pruning
- Rate limiting (token bucket algorithm)
- Error handling and logging
- XSS protection with DOMPurify
- Input sanitization

**Required Override:**
- `getDataSources()` - Return array of DataSourceBase instances

**Optional Overrides:**
- `getSystemPromptBuilder()` - Return function that builds system prompt
- `getDataCallback()` - Handle tool execution results
- `validateConfig()` - Custom config validation
- `onMapReady()` - Called when map is initialized
- `onInitialized()` - Called after full initialization
- `onClearConversation()` - Custom clear logic

### 3. Map Tools

The framework includes 15+ pre-built map tools that AI can use:

**Data Display:**
- `add_points_to_map` - Add GeoJSON points to map
- `highlight_recommended_pois` - Mark recommended items with stars
- `clear_all_markers` - Remove all markers from map
- `get_all_map_pois` - Get all POIs currently on map

**Geocoding:**
- `geocode_location` - Convert address to coordinates
- `reverse_geocode` - Convert coordinates to address
- `search_location` - Search for infrastructure locations

**Routing & Navigation:**
- `get_directions` - Calculate routes between waypoints
- `hide_all_routes` - Hide route layers
- `show_all_routes` - Show route layers
- `clear_all_routes` - Remove all routes

**Isochrones (Reachable Areas):**
- `get_isochrone` - Show areas within travel time
- `hide_all_isochrones` - Hide isochrone layers
- `show_all_isochrones` - Show isochrone layers
- `clear_all_isochrones` - Remove all isochrones

**Travel Analysis:**
- `get_travel_time_matrix` - Calculate travel times between multiple points

Your AI can use these automatically through the MapController!

### 4. Speech Recognition

Built-in voice input with automatic platform detection:

**Supported Platforms:**
- Desktop browsers (Chrome, Edge, Safari) - Web Speech API
- Mobile browsers (iOS Safari, Chrome Mobile) - Web Speech API
- LG webOS TVs - MediaRecorder + Google Cloud Speech-to-Text
- Firefox - MediaRecorder + Google Cloud Speech-to-Text

**Features:**
- Automatic silence detection (hands-free operation)
- Automatic language detection from i18n settings
- Visual recording indicators
- Graceful fallback between recognition methods
- Production-ready error handling

**Setup:**
```javascript
// 1. Enable in config
SPEECH_RECOGNITION_ENABLED: true,
SPEECH_AUTO_SEND: true,  // Auto-send after transcription

// 2. Add microphone button to HTML
<button id="micBtn"><span id="micIcon">🎤</span></button>

// 3. Set Lambda environment variable (for MediaRecorder mode)
GOOGLE_SPEECH_API_KEY=your_api_key
```

**See:** [Speech Recognition Documentation](./docs/speech-recognition.md)

### 5. Text-to-Speech

Hybrid TTS with two quality levels:

**Two Modes:**
1. **Web Speech API** (default) - Browser-native, free, instant
2. **Google Cloud TTS** (premium) - WaveNet/Neural2 voices, very natural ($16/1M chars)

**Features:**
- Auto-speak mode (automatically speaks all AI responses)
- Per-message speaker icons for manual control
- Multi-language voice support (English, Japanese, 40+ languages)
- Visual feedback and playback controls
- Choose between free browser voices or premium Google voices

**Setup:**
```javascript
// 1. Enable in config (Web Speech API - free)
TTS_ENABLED: true,
TTS_AUTO_SPEAK: false,  // Toggle on/off via UI

// 2. OR enable Google Cloud TTS (premium quality)
TTS_USE_GOOGLE_CLOUD: true,
TTS_GOOGLE_VOICE_NAME: 'ja-JP-Neural2-B',  // Natural Japanese voice

// 3. Add toggle button to HTML
<button id="tts-toggle"><span id="tts-icon">🔇</span></button>

// 4. Speaker icons automatically added to messages
```

**Platform Support:** Chrome, Safari, Edge, Firefox, iOS, Android, LG webOS TVs

**See:** [Text-to-Speech Documentation](./docs/text-to-speech.md)

### 6. AI Clients

Pre-configured Claude and Gemini clients with:
- Token tracking with auto-pruning at threshold
- Context management (location, map view)
- Tool execution from data sources and map
- Error recovery with exponential backoff
- Streaming support (disabled by default to avoid proxy errors)
- Conversation history management
- WeakMap caching for performance

**ClaudeClient Constructor Options:**
```javascript
{
  apiKey,                    // API key
  dataSources,              // Array of DataSourceBase instances
  mapController,            // MapController instance
  i18n,                     // I18n instance
  config,                   // Configuration object
  app,                      // Reference to app (optional)
  systemPromptBuilder,      // Custom system prompt function
  onDataCallback,           // Data processing callback
  thinkingSimulator         // ThinkingSimulator instance
}
```

## Examples

### Real Estate Demo

```javascript
export class RealEstateMCP extends DataSourceBase {
  async initialize() {
    this.properties = await fetch('./data/listings.json').then(r => r.json());
  }

  listTools() {
    return [{
      name: 'search_properties',
      description: 'Search properties by price, bedrooms, location',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' },
          price_max: { type: 'number' },
          bedrooms: { type: 'number' }
        }
      }
    }];
  }

  async executeTool(toolName, args) {
    let results = this.properties;

    if (args.price_max) {
      results = results.filter(p => p.price <= args.price_max);
    }

    if (args.bedrooms) {
      results = results.filter(p => p.bedrooms >= args.bedrooms);
    }

    return this.createToolResult({
      count: results.length,
      geojson: this.toGeoJSON(results, (prop) => ({
        geometry: {
          type: 'Point',
          coordinates: [prop.longitude, prop.latitude]
        },
        properties: {
          name: prop.address,
          price: `$${prop.price.toLocaleString()}`,
          bedrooms: prop.bedrooms,
          summary: `${prop.bedrooms}BR/${prop.bathrooms}BA`
        }
      }))
    });
  }
}
```

### Ride Hailing Demo

```javascript
export class RideHailingMCP extends DataSourceBase {
  async initialize() {
    this.drivers = new Map(); // driver_id -> location
    this.startPolling(); // Update driver locations
  }

  listTools() {
    return [
      {
        name: 'find_nearby_drivers',
        description: 'Find available drivers near a location',
        inputSchema: {
          type: 'object',
          properties: {
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            radius_miles: { type: 'number', default: 2 }
          }
        }
      },
      {
        name: 'estimate_fare',
        description: 'Estimate fare for a trip',
        inputSchema: {
          type: 'object',
          properties: {
            pickup: { type: 'object' },
            dropoff: { type: 'object' }
          }
        }
      }
    ];
  }

  async executeTool(toolName, args) {
    if (toolName === 'find_nearby_drivers') {
      const nearby = this.findWithinRadius(
        args.latitude,
        args.longitude,
        args.radius_miles
      );

      return this.createToolResult({
        drivers: nearby,
        count: nearby.length
      });
    }

    if (toolName === 'estimate_fare') {
      const distance = this.calculateDistance(args.pickup, args.dropoff);
      const base = 3.00;
      const perMile = 1.50;
      const fare = base + (distance * perMile);

      return this.createToolResult({
        distance_miles: distance.toFixed(1),
        estimated_fare: `$${fare.toFixed(2)}`,
        pickup_time_mins: 5
      });
    }
  }
}
```

## Lambda Deployment

The framework includes a production-ready Lambda handler for proxying AI API calls.

### Features
- Supports Claude and Gemini
- CORS handling
- Origin validation
- Rate limiting (100 req/min per IP)
- Streaming support
- Error handling

### Setup

1. **Deploy to AWS Lambda:**
   ```bash
   cd src/lambda
   zip -r function.zip handler.js
   aws lambda create-function \
     --function-name ai-proxy \
     --runtime nodejs18.x \
     --handler handler.handler \
     --zip-file fileb://function.zip
   ```

2. **Set environment variables:**
   - `CLAUDE_API_KEY` - Your Claude API key
   - `GEMINI_API_KEY` - Your Gemini API key (optional)
   - `ALLOWED_ORIGINS` - Comma-separated origins (e.g., `https://yourdomain.com`)
   - `RATE_LIMIT_MAX_REQUESTS` - Max requests per minute (default: 100)

3. **Create Function URL:**
   ```bash
   aws lambda create-function-url-config \
     --function-name ai-proxy \
     --auth-type NONE \
     --cors '{"AllowOrigins": ["https://yourdomain.com"], "AllowMethods": ["POST"], "AllowHeaders": ["*"]}'
   ```

## Advanced Usage

### Custom Lifecycle Hooks

```javascript
class MyApp extends BaseApp {
  // Called after map loads
  async onMapReady() {
    console.log('Map is ready');
    // Add custom map layers, controls, etc.
  }

  // Called after full initialization
  async onInitialized() {
    console.log('App fully initialized');
    // Start background tasks, analytics, etc.
  }

  // Called when conversation is cleared
  onClearConversation() {
    console.log('Clearing conversation');
    // Reset custom state, clear visualizations, etc.
  }

  // Validate configuration
  validateConfig() {
    if (!this.config.CUSTOM_REQUIRED_FIELD) {
      throw new Error('CUSTOM_REQUIRED_FIELD is required');
    }
  }
}
```

### Custom Thinking Messages

```javascript
import { ThinkingSimulator } from '@mapdemos/ai-framework/core';

class MyThinkingMessages {
  generateMessages({ question, location, category }) {
    return [
      `🔍 Searching ${category} in ${location}...`,
      `📊 Analyzing ${category} data...`,
      `⭐ Curating top recommendations...`
    ];
  }
}

const simulator = new ThinkingSimulator(i18n, new MyThinkingMessages());
```

### Multi-Language Support

```javascript
import { I18n } from '@mapdemos/ai-framework/core';

const translations = {
  en: {
    title: 'My App',
    sendButton: 'Send',
    errors: {
      network: 'Network error occurred'
    }
  },
  es: {
    title: 'Mi Aplicación',
    sendButton: 'Enviar',
    errors: {
      network: 'Error de red'
    }
  }
};

const i18n = new I18n('en', translations);
// Access nested keys with dot notation
console.log(i18n.t('errors.network')); // "Network error occurred"
```

### Token Management

The framework automatically manages Claude's context window:

```javascript
// Configuration
const CONFIG = {
  MAX_CONTEXT_TOKENS: 200000,      // Max tokens allowed
  PRUNE_THRESHOLD_TOKENS: 160000,  // Auto-prune at this level
  WARNING_THRESHOLD_TOKENS: 140000 // Show warning at this level
};

// In your app
class MyApp extends BaseApp {
  async onInitialized() {
    // Monitor token usage
    const usage = this.claudeClient.getTokenUsage();
    console.log(`Tokens used: ${usage.total}`);
  }
}
```

Features:
- Automatic conversation pruning at threshold
- Token counter display in UI
- WeakMap caching for performance
- Warning when approaching limits

### Rate Limiting

The framework implements Token Bucket algorithm for rate limiting:

```javascript
const CONFIG = {
  REQUEST_RATE_LIMIT_MS: 1000,     // Min interval between requests
  RATE_LIMIT_BURST_CAPACITY: 5,    // Allow 5 rapid requests
  RATE_LIMIT_REFILL_RATE: 1        // Refill 1 token per second
};
```

Features:
- Client-side rate limiting prevents API abuse
- Server-side rate limiting (100 req/min per IP)
- Queue system for handling rapid requests
- Automatic retry with exponential backoff
- Returns 429 with Retry-After header when limited

## Best Practices

### 1. Tool Design
- Keep tools focused (one responsibility)
- Provide clear descriptions for AI
- Return GeoJSON for map visualization
- Include count and summary in results

### 2. System Prompts
- Define AI's personality and expertise
- Explain available tools clearly
- Specify when to ask clarifying questions
- Give examples of good interactions

### 3. Error Handling
- Use `createErrorResult()` for tool errors
- Return partial results when possible
- Log errors for debugging
- Provide user-friendly messages

### 4. Performance
- Load data asynchronously
- Cache expensive operations
- Paginate large result sets
- Use debouncing for map updates

### 5. Security
- Never expose API keys in frontend - use Lambda proxy
- XSS protection with DOMPurify integration
- Input sanitization (removes scripts, iframes, event handlers)
- Script origin validation with whitelist approach
- CSRF protection via origin and referer validation
- Rate limiting on both client (token bucket) and server
- Max input length validation (configurable)
- External data sanitization in tool results

## Utility Functions

The framework exports several utility functions:

### Core Utilities
- `errorLogger` - Singleton error tracking with frequency analysis
- `safeGet(obj, path, defaultValue)` - Safe nested property access
- `safeGetElement(selector)` - Safe DOM element retrieval
- `safeArray(value)` - Ensure value is an array
- `safeNumber(value, defaultValue)` - Safe number conversion
- `safeCoordinates(coords)` - Validate coordinate pairs
- `asyncErrorWrapper(fn, options)` - Wrap async functions with error handling

### Geolocation Utilities
- `getUserLocation()` - Promise-based browser geolocation
- `isLocationInBounds(location, bounds)` - Check if location is within bounds
- `calculateDistance(point1, point2)` - Calculate distance between points

### Map Service Utilities
- `geocodeLocation(location, accessToken, options)` - Mapbox Geocoding API
- `reverseGeocode(longitude, latitude, accessToken)` - Reverse geocoding
- `getDirections(waypoints, accessToken, options)` - Directions API
- `getIsochrone(coordinates, accessToken, options)` - Isochrone API
- `extractJapaneseNames(properties)` - Extract Japanese place names

## API Reference

See full API documentation at: [docs/api-reference.md](./docs/api-reference.md)

## Examples

Check out complete working examples in separate repositories:

- Japan Tourism Demo - POI search with travel recommendations
