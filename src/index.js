/**
 * Mapbox AI Framework
 * Main entry point - exports all framework modules
 *
 * Usage:
 * ```javascript
 * import { DataSourceBase, ClaudeClient, MapController, I18n } from 'mapbox-ai-framework';
 * ```
 *
 * Or import from specific modules:
 * ```javascript
 * import { DataSourceBase } from 'mapbox-ai-framework/data';
 * import { ClaudeClient } from 'mapbox-ai-framework/ai';
 * import { MapController } from 'mapbox-ai-framework/map';
 * import { I18n, ThinkingSimulator } from 'mapbox-ai-framework/core';
 * ```
 */

// Core utilities
export {
  errorLogger,
  safeGet,
  safeGetElement,
  safeCoordinates,
  safeArray,
  safeNumber,
  ThinkingSimulator,
  DefaultMessageProvider,
  I18n
} from './core/index.js';

// Data layer
export { DataSourceBase } from './data/index.js';

// AI clients
export { ClaudeClient, GeminiClient } from './ai/index.js';

// Map layer
export {
  MapController,
  geocodeLocation,
  reverseGeocode,
  getDirections,
  getIsochrone,
  extractJapaneseNames
} from './map/index.js';
