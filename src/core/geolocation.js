/**
 * Geolocation Utilities
 * Browser geolocation API wrapper with promises
 */

/**
 * Get user's current location using browser geolocation API
 * @param {Object} options - Geolocation options
 * @param {number} options.timeout - Timeout in milliseconds (default: 10000)
 * @param {boolean} options.enableHighAccuracy - Enable high accuracy (default: true)
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number}>}
 */
export async function getUserLocation(options = {}) {
  const {
    timeout = 10000,
    enableHighAccuracy = true
  } = options;

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported by this browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        // Provide user-friendly error messages
        let message;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = 'User denied geolocation permission';
            break;
          case error.POSITION_UNAVAILABLE:
            message = 'Location information unavailable';
            break;
          case error.TIMEOUT:
            message = 'Geolocation request timed out';
            break;
          default:
            message = 'Unknown geolocation error';
        }
        reject(new Error(message));
      },
      { timeout, enableHighAccuracy }
    );
  });
}

/**
 * Check if a location is within a bounding box
 * @param {number} longitude - Longitude to check
 * @param {number} latitude - Latitude to check
 * @param {Object} bounds - Bounding box {north, south, east, west}
 * @returns {boolean}
 */
export function isLocationInBounds(longitude, latitude, bounds) {
  return (
    latitude >= bounds.south &&
    latitude <= bounds.north &&
    longitude >= bounds.west &&
    longitude <= bounds.east
  );
}

/**
 * Calculate distance between two coordinates in kilometers using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in kilometers
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
