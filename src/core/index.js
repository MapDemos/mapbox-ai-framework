/**
 * Framework Core Utilities
 * Domain-agnostic utilities for error handling, safe operations, etc.
 */

export { errorLogger } from './error-logger.js';
export {
  safeGet,
  safeGetElement,
  safeCoordinates,
  safeArray,
  safeNumber
} from './utils.js';
export { ThinkingSimulator, DefaultMessageProvider } from './thinking-simulator.js';
export { I18n } from './i18n.js';
export {
  getUserLocation,
  isLocationInBounds,
  calculateDistance
} from './geolocation.js';
export { SpeechRecognitionManager } from './speech-recognition-manager.js';
export { TextToSpeechManager } from './text-to-speech-manager.js';
