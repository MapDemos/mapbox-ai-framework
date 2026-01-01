/**
 * Utility Functions
 * Helper functions for safe operations and common tasks
 */

/**
 * Safely get a nested property from an object
 * @param {Object} obj - The object to query
 * @param {string} path - Dot-separated path (e.g., 'user.profile.name')
 * @param {*} defaultValue - Default value if path doesn't exist
 * @returns {*} The value at path or defaultValue
 */
export function safeGet(obj, path, defaultValue = null) {
  if (!obj || typeof obj !== 'object') return defaultValue;

  const keys = path.split('.');
  let result = obj;

  for (const key of keys) {
    if (result === null || result === undefined || typeof result !== 'object') {
      return defaultValue;
    }
    result = result[key];
  }

  return result !== undefined ? result : defaultValue;
}

/**
 * Safely parse JSON with fallback
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed object or defaultValue
 */
export function safeJSONParse(jsonString, defaultValue = null) {
  if (!jsonString || typeof jsonString !== 'string') {
    return defaultValue;
  }

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn('[Utils] JSON parse error:', error.message);
    return defaultValue;
  }
}

/**
 * Safely get DOM element by ID
 * @param {string} id - Element ID
 * @returns {HTMLElement|null} Element or null
 */
export function safeGetElement(id) {
  if (!id || typeof id !== 'string') return null;

  try {
    return document.getElementById(id);
  } catch (error) {
    console.warn(`[Utils] Error getting element '${id}':`, error.message);
    return null;
  }
}

/**
 * Safely get numeric value with bounds checking
 * @param {*} value - Value to convert to number
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @param {number} defaultValue - Default if invalid
 * @returns {number} Safe numeric value
 */
export function safeNumber(value, min = -Infinity, max = Infinity, defaultValue = 0) {
  const num = Number(value);

  if (isNaN(num)) return defaultValue;
  if (num < min) return min;
  if (num > max) return max;

  return num;
}

/**
 * Safely get array with validation
 * @param {*} value - Value to validate as array
 * @param {*} defaultValue - Default if not array
 * @returns {Array} Valid array or defaultValue
 */
export function safeArray(value, defaultValue = []) {
  return Array.isArray(value) ? value : defaultValue;
}

/**
 * Safely access coordinates from various formats
 * @param {*} coords - Coordinates in various formats
 * @returns {[number, number]|null} [lng, lat] or null
 */
export function safeCoordinates(coords) {
  // Handle [lng, lat] array
  if (Array.isArray(coords) && coords.length >= 2) {
    const lng = safeNumber(coords[0], -180, 180, null);
    const lat = safeNumber(coords[1], -90, 90, null);
    return (lng !== null && lat !== null) ? [lng, lat] : null;
  }

  // Handle {lng, lat} or {lon, lat} object
  if (coords && typeof coords === 'object') {
    const lng = safeNumber(coords.lng || coords.lon, -180, 180, null);
    const lat = safeNumber(coords.lat, -90, 90, null);
    return (lng !== null && lat !== null) ? [lng, lat] : null;
  }

  return null;
}

/**
 * Check if value is null or undefined
 * @param {*} value - Value to check
 * @returns {boolean} True if null or undefined
 */
export function isNullOrUndefined(value) {
  return value === null || value === undefined;
}

/**
 * Get first non-null value from arguments
 * @param {...*} values - Values to check
 * @returns {*} First non-null value or null
 */
export function coalesce(...values) {
  for (const value of values) {
    if (!isNullOrUndefined(value)) {
      return value;
    }
  }
  return null;
}
