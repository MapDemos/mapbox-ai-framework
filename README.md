# Mapbox AI Framework

Build AI-powered map applications in minutes. Combines Mapbox GL JS with Claude/Gemini AI for intelligent, conversational map experiences.

## Features

- 🤖 **AI Integration**: Pre-built Claude and Gemini clients with streaming support
- 🗺️ **Map Tools**: Mapbox GL JS utilities (geocoding, directions, isochrones)
- 🔌 **MCP Pattern**: Model Context Protocol for connecting AI to data sources
- 🛠️ **Base Classes**: Extend `DataSourceBase` for your domain
- 🌐 **Lambda Proxy**: Secure AI API proxy with rate limiting and CORS
- 🔒 **Production Ready**: Error handling, token management, rate limiting
- 📦 **Zero Config**: Sensible defaults, easy customization

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
import { AppBase } from '@mapdemos/ai-framework';
import { MyDataMCP } from './modules/my-data-mcp.js';
import { CONFIG } from './config.js';

class MyApp extends AppBase {
  async initializeDataSource() {
    this.dataMCP = new MyDataMCP(this.config, this);
    await this.dataMCP.initialize();
  }

  buildSystemPrompt() {
    return `You are an AI assistant helping users find items.

    Use the search_items tool to search our database.
    Always ask for location if not provided.
    Present 3-5 top recommendations.`;
  }
}

const app = new MyApp(CONFIG);
app.initialize();
```

### 4. Configure

```javascript
// config.js
export const CONFIG = {
  MAPBOX_ACCESS_TOKEN: 'pk.ey...',
  CLAUDE_API_PROXY: 'https://your-lambda.aws.com',
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  DEFAULT_MAP_CENTER: [-122.4194, 37.7749],
  DEFAULT_MAP_ZOOM: 12
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

**Framework handles: 11,000+ lines of production code**

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

### 2. AppBase

Main application orchestration. Handles:
- Map initialization
- AI client setup
- Event handlers
- UI updates
- Token management
- Rate limiting
- Error handling

**Override Points:**
- `initializeDataSource()` - Create your MCP client
- `buildSystemPrompt()` - Define AI behavior
- `createI18n()` - Custom translations

### 3. Map Tools

The framework includes pre-built map tools:
- `get_map_view` - Get current map viewport
- `get_directions` - Calculate routes
- `get_isochrone` - Show areas within travel time
- `highlight_recommended_pois` - Mark recommended items
- `show_search_results` - Display all search results
- `clear_search_results` - Remove results from map

Your AI can use these automatically!

### 4. AI Clients

Pre-configured Claude and Gemini clients with:
- Streaming responses
- Token tracking and auto-pruning
- Context management
- Tool execution
- Error recovery

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
   cd framework/src/lambda
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

### Custom Map Marker Formatting

```javascript
class MyApp extends AppBase {
  constructor(config) {
    super(config);

    // Customize POI marker display
    this.markerFormatter = (properties) => ({
      title: properties.name,
      description: properties.custom_field,
      imageUrl: properties.photo,
      price: properties.price,
      rating: properties.rating
    });
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
    sendButton: 'Send'
  },
  es: {
    title: 'Mi Aplicación',
    sendButton: 'Enviar'
  }
};

const i18n = new I18n('en', translations);
```

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
- Never expose API keys in frontend
- Use Lambda proxy for AI calls
- Validate and sanitize user input
- Set CORS and origin restrictions

## API Reference

See full API documentation at: [docs/api-reference.md](./docs/api-reference.md)

## Examples

Check out complete working examples:

- [Japan Tourism Demo](../demos/japan-tourism/) - POI search with Rurubu API
- [Real Estate Demo](./examples/real-estate/) - Property search and recommendations
- [Ride Hailing Demo](./examples/ride-hailing/) - Driver matching and fare estimation

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

ISC

## Support

- 📖 [Documentation](./docs/)
- 💬 [GitHub Issues](https://github.com/MapDemos/mapbox-ai-framework/issues)
- 🎥 [Video Tutorials](https://www.youtube.com/mapbox)
