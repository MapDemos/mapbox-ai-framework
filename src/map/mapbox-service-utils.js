/**
 * Mapbox Service Utilities
 * Shared utilities for Mapbox API services (Geocoding, Directions, Map Matching, Matrix, etc.)
 * These functions can be used internally by other modules or exposed as MCP tools
 */

/**
 * Geocode a location name to coordinates using Mapbox Geocoding API v6
 * @param {string} location - Location name (e.g., "Shibuya", "Tokyo", "渋谷")
 * @param {string} accessToken - Mapbox access token
 * @param {object} options - Additional options
 * @returns {object|null} - Mapbox geocoding feature or null if not found
 */
export async function geocodeLocation(location, accessToken, options = {}) {
  try {
    const params = new URLSearchParams({
      q: location,
      country: options.country || 'JP',                    // Restrict to Japan by default
      language: options.language || 'ja',                  // Japanese language for results
      types: options.types || 'place,locality,neighborhood', // Municipality-level results
      limit: options.limit || '1',                         // Only need top result by default
      autocomplete: options.autocomplete || 'false',       // Prefer exact matches
      access_token: accessToken
    });

    const url = `https://api.mapbox.com/search/geocode/v6/forward?${params}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Mapbox Geocoding v6] Failed: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];

      return feature;
    }

    console.warn(`[Mapbox Geocoding v6] No results for: ${location}`);
    return null;

  } catch (error) {
    console.error(`[Mapbox Geocoding v6] Error:`, error);
    return null;
  }
}

/**
 * Extract Japanese place names from Mapbox Geocoding v6 result
 * @param {object} feature - Mapbox geocoding v6 feature (GeoJSON format)
 * @returns {string[]} - Array of Japanese place names
 */
export function extractJapaneseNames(feature) {
  const names = new Set(); // Use Set to avoid duplicates

  const props = feature.properties || {};

  // Priority 1: Main feature name
  if (props.name) {
    names.add(props.name);
  }

  // Priority 2: Context hierarchy (parent locations)
  if (props.context) {
    // v6 context structure: { locality, place, region, country, etc. }
    for (const [type, contextInfo] of Object.entries(props.context)) {
      if (contextInfo?.name) {
        names.add(contextInfo.name);
      }
    }
  }

  // Priority 3: Parse full_address or place_formatted
  const addressString = props.full_address || props.place_formatted;
  if (addressString) {
    // "渋谷区, 東京都, 日本" → ["渋谷区", "東京都"]
    const parts = addressString.split(/[,、]/);
    parts.forEach(p => {
      const trimmed = p.trim();
      if (trimmed && trimmed !== '日本' && trimmed !== 'Japan') { // Exclude "Japan"
        names.add(trimmed);
      }
    });
  }

  const result = Array.from(names).filter(n => n.length > 0);
  return result;
}

/**
 * Reverse geocode coordinates to address using Mapbox Geocoding API v6
 * @param {number} longitude - Longitude
 * @param {number} latitude - Latitude
 * @param {string} accessToken - Mapbox access token
 * @param {object} options - Additional options
 * @returns {object|null} - Mapbox geocoding feature or null if not found
 */
export async function reverseGeocode(longitude, latitude, accessToken, options = {}) {
  // Validate coordinates
  if (longitude === undefined || latitude === undefined || longitude === null || latitude === null) {
    console.warn('[Mapbox Reverse Geocoding v6] Invalid coordinates:', { longitude, latitude });
    return null;
  }

  try {
    const params = new URLSearchParams({
      longitude: longitude.toString(),
      latitude: latitude.toString(),
      types: options.types || 'address,place,locality,neighborhood',
      language: options.language || 'ja',
      limit: options.limit || '1',
      access_token: accessToken
    });

    const url = `https://api.mapbox.com/search/geocode/v6/reverse?${params}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[Mapbox Reverse Geocoding v6] Failed: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];

      return feature;
    }

    console.warn(`[Mapbox Reverse Geocoding v6] No results for: [${longitude}, ${latitude}]`);
    return null;

  } catch (error) {
    console.error(`[Mapbox Reverse Geocoding v6] Error:`, error);
    return null;
  }
}

/**
 * Search for locations using Mapbox SearchBox API (forward endpoint)
 * @param {string} query - Search query (e.g., "Tokyo Tower", "Shibuya Station")
 * @param {string} accessToken - Mapbox access token
 * @param {object} options - Additional options (proximity, limit, country, etc.)
 * @returns {object} - Search results with coordinates and details
 */
export async function searchLocation(query, accessToken, options = {}) {
  try {
    if (!query || query.trim() === '') {
      throw new Error('Search query is required');
    }

    // Build API URL - using Search Box API /forward endpoint (returns full results with coordinates)
    const params = new URLSearchParams({
      q: query.trim(),
      access_token: accessToken,
      limit: options.limit || 5,
      language: options.language || 'en'
    });

    // Add optional parameters
    if (options.proximity) {
      // proximity format: longitude,latitude
      params.append('proximity', `${options.proximity[0]},${options.proximity[1]}`);
    }
    if (options.country) {
      params.append('country', options.country); // e.g., "JP"
    }
    if (options.types) {
      params.append('types', options.types); // e.g., "place,address,poi"
    }
    if (options.bbox) {
      // bbox format: min_lng,min_lat,max_lng,max_lat
      params.append('bbox', options.bbox.join(','));
    }

    const url = `https://api.mapbox.com/search/searchbox/v1/forward?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Mapbox SearchBox] API error response:`, errorText);
      throw new Error(`SearchBox API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      console.warn(`[Mapbox SearchBox] No results for: "${query}"`);
      return {
        success: false,
        query: query,
        results: []
      };
    }

    // Format results
    const results = data.features.map((feature, index) => {
      const props = feature.properties;

      return {
        name: props.name || props.full_address,
        full_address: props.full_address || props.place_formatted,
        place_formatted: props.place_formatted,     // Just the address without name
        coordinates: feature.geometry.coordinates,
        mapbox_id: props.mapbox_id,
        feature_type: props.feature_type,
        context: props.context,

        // POI category information for icon display
        poi_category: props.poi_category,           // Array like ["restaurant", "sushi restaurant"]
        poi_category_ids: props.poi_category_ids,   // Canonical IDs
        maki: props.maki,                           // Mapbox icon identifier (e.g., "restaurant-15")

        // Additional useful metadata
        metadata: props.metadata,                   // Contains Japanese readings for Japan POIs
        brand: props.brand,                         // Brand name if chain
        external_ids: props.external_ids            // Links to Foursquare, SafeGraph, etc.
      };
    });

    return {
      success: true,
      query: query,
      results: results
    };

  } catch (error) {
    console.error('[Mapbox SearchBox] Error:', error);
    throw error;
  }
}

/**
 * Get directions between waypoints using Mapbox Directions API
 * @param {array} waypoints - Array of [lng, lat] coordinates
 * @param {string} accessToken - Mapbox access token
 * @param {object} options - Additional options (profile, steps, geometries, etc.)
 * @returns {object} - Directions response with routes
 */
export async function getDirections(waypoints, accessToken, options = {}) {
  try {
    if (!waypoints || waypoints.length < 2) {
      throw new Error('At least 2 waypoints are required');
    }

    if (waypoints.length > 25) {
      throw new Error('Maximum 25 waypoints allowed');
    }

    // Default options
    const profile = options.profile || 'driving'; // Note: For Directions API, profile is just the suffix (not "mapbox/profile")
    const steps = options.steps !== undefined ? options.steps : true;
    const geometries = options.geometries || 'geojson';
    const language = options.language || 'en';
    const overview = options.overview || 'full';
    const alternatives = options.alternatives !== undefined ? options.alternatives : false;
    const continue_straight = options.continue_straight !== undefined ? options.continue_straight : false;

    // Build coordinates string (lng,lat;lng,lat;...)
    const coordinates = waypoints
      .map(coord => `${coord[0]},${coord[1]}`)
      .join(';');

    // Build API URL
    const params = new URLSearchParams({
      access_token: accessToken,
      steps: steps.toString(),
      geometries: geometries,
      language: language,
      overview: overview,
      alternatives: alternatives.toString(),
      continue_straight: continue_straight.toString()
    });

    // Add optional parameters
    if (options.exclude) {
      params.append('exclude', options.exclude); // toll, motorway, ferry, unpaved
    }
    if (options.banner_instructions !== undefined) {
      params.append('banner_instructions', options.banner_instructions.toString());
    }
    if (options.voice_instructions !== undefined) {
      params.append('voice_instructions', options.voice_instructions.toString());
    }

    const url = `https://api.mapbox.com/directions/v5/mapbox.tmp.valhalla-zenrin/${profile}/${coordinates}?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Directions API error: ${error.message || response.statusText}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found between the waypoints');
    }

    return data;

  } catch (error) {
    console.error('[Mapbox Directions] Error:', error);
    throw error;
  }
}

/**
 * Match GPS traces to road network using Mapbox Map Matching API
 * TODO: Implement when needed
 * @param {array} coordinates - Array of [lng, lat] coordinates
 * @param {string} accessToken - Mapbox access token
 * @param {object} options - Additional options (profile, timestamps, etc.)
 * @returns {object|null} - Map matching response or null if failed
 */
export async function matchToRoads(coordinates, accessToken, options = {}) {
  // TODO: Implement Mapbox Map Matching API
  console.warn('[Mapbox Map Matching] Not yet implemented');
  return null;
}

/**
 * Get travel time matrix between multiple points using Mapbox Matrix API
 * @param {array} coordinates - Array of [lng, lat] coordinates (max 25 for standard, 10 for traffic)
 * @param {string} accessToken - Mapbox access token
 * @param {object} options - Additional options (profile, sources, destinations, annotations, etc.)
 * @returns {object} - Matrix response with durations and distances
 */
export async function getTravelTimeMatrix(coordinates, accessToken, options = {}) {
  try {
    if (!coordinates || coordinates.length < 2) {
      throw new Error('At least 2 coordinates are required');
    }

    // Default profile - MUST include "mapbox/" prefix
    const profile = options.profile || 'mapbox/driving';

    // Valid profiles: mapbox/driving, mapbox/walking, mapbox/cycling, mapbox/driving-traffic
    const validProfiles = ['mapbox/driving', 'mapbox/walking', 'mapbox/cycling', 'mapbox/driving-traffic'];
    if (!validProfiles.includes(profile)) {
      throw new Error(`Invalid profile: ${profile}. Must be one of: ${validProfiles.join(', ')}`);
    }

    // Validate coordinate limits based on profile
    const maxCoords = profile === 'mapbox/driving-traffic' ? 10 : 25;
    if (coordinates.length > maxCoords) {
      throw new Error(`Maximum ${maxCoords} coordinates allowed for profile: ${profile}`);
    }

    // Validate coordinates format
    for (const coord of coordinates) {
      if (!Array.isArray(coord) || coord.length !== 2) {
        throw new Error('Each coordinate must be an array of [longitude, latitude]');
      }
      if (typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
        throw new Error('Coordinates must be numbers');
      }
      // Validate coordinate ranges
      if (coord[0] < -180 || coord[0] > 180) {
        throw new Error(`Invalid longitude: ${coord[0]} (must be between -180 and 180)`);
      }
      if (coord[1] < -90 || coord[1] > 90) {
        throw new Error(`Invalid latitude: ${coord[1]} (must be between -90 and 90)`);
      }
    }

    // Default annotations
    const annotations = options.annotations || ['duration', 'distance'];
    const fallback_speed = options.fallback_speed; // Optional fallback speed in km/h

    // Build coordinates string (lng,lat;lng,lat;...)
    const coordinatesString = coordinates
      .map(coord => `${coord[0]},${coord[1]}`)
      .join(';');

    // Build API URL
    const params = new URLSearchParams({
      access_token: accessToken,
      annotations: annotations.join(',')
    });

    // Add optional parameters
    if (options.sources !== undefined) {
      // Indices of coordinates to use as sources (semicolon-separated, e.g., "0;1;2" or "all")
      const sources = options.sources === 'all' ? 'all' :
                      Array.isArray(options.sources) ? options.sources.join(';') :
                      options.sources.toString();

      // Validate source indices if not "all"
      if (sources !== 'all') {
        const sourceIndices = sources.split(';').map(Number);
        for (const idx of sourceIndices) {
          if (idx < 0 || idx >= coordinates.length) {
            throw new Error(`Invalid source index: ${idx} (must be between 0 and ${coordinates.length - 1})`);
          }
        }
      }
      params.append('sources', sources);
    }

    if (options.destinations !== undefined) {
      // Indices of coordinates to use as destinations (semicolon-separated, e.g., "0;1;2" or "all")
      const destinations = options.destinations === 'all' ? 'all' :
                           Array.isArray(options.destinations) ? options.destinations.join(';') :
                           options.destinations.toString();

      // Validate destination indices if not "all"
      if (destinations !== 'all') {
        const destIndices = destinations.split(';').map(Number);
        for (const idx of destIndices) {
          if (idx < 0 || idx >= coordinates.length) {
            throw new Error(`Invalid destination index: ${idx} (must be between 0 and ${coordinates.length - 1})`);
          }
        }
      }
      params.append('destinations', destinations);
    }

    if (fallback_speed !== undefined) {
      params.append('fallback_speed', fallback_speed.toString());
    }

    // Correct URL format - profile already contains "mapbox/" prefix
    const url = `https://api.mapbox.com/directions-matrix/v1/${profile}/${coordinatesString}?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      let errorMessage = `Matrix API error (${response.status}): ${response.statusText}`;
      try {
        const error = await response.json();
        errorMessage = `Matrix API error: ${error.message || error.code || response.statusText}`;
      } catch (e) {
        // If error response is not JSON, use status text
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    // Check for successful response
    if (data.code && data.code !== 'Ok') {
      throw new Error(`Matrix API returned error code: ${data.code}${data.message ? ' - ' + data.message : ''}`);
    }

    // Validate that we have either durations or distances
    if (!data.durations && !data.distances) {
      throw new Error('No matrix data returned - response missing durations and distances arrays');
    }

    return data;

  } catch (error) {
    console.error('[Mapbox Matrix API] Error:', error);
    throw error;
  }
}

/**
 * Get isochrone (reachable area) from a location using Mapbox Isochrone API
 * @param {array} coordinates - Starting point [lng, lat]
 * @param {string} accessToken - Mapbox access token
 * @param {object} options - Additional options
 * @returns {object} - Isochrone response (GeoJSON FeatureCollection)
 */
export async function getIsochrone(coordinates, accessToken, options = {}) {
  try {
    if (!coordinates || coordinates.length !== 2) {
      throw new Error('Coordinates must be [longitude, latitude]');
    }

    // Default options
    const profile = options.profile || 'driving'; // Note: For Isochrone API, profile is just the suffix (not "mapbox/profile")
    const contours_minutes = options.contours_minutes || [10, 20, 30]; // Up to 4 values
    const polygons = options.polygons !== undefined ? options.polygons : true;
    const denoise = options.denoise !== undefined ? options.denoise : 1.0;
    const colors = options.colors || ['6706ce', '04e813', 'ff0000']; // Default colors

    // Build API URL
    const coordsString = `${coordinates[0]},${coordinates[1]}`;
    const params = new URLSearchParams({
      access_token: accessToken,
      contours_minutes: contours_minutes.join(','),
      polygons: polygons.toString(),
      denoise: denoise.toString()
    });

    // Add optional parameters
    if (colors && colors.length === contours_minutes.length) {
      params.append('contours_colors', colors.join(','));
    }
    if (options.generalize) {
      params.append('generalize', options.generalize.toString());
    }
    if (options.exclude) {
      params.append('exclude', options.exclude);
    }

    const url = `https://api.mapbox.com/isochrone/v1/mapbox/${profile}/${coordsString}?${params.toString()}`;

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Isochrone API error: ${error.message || response.statusText}`);
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      throw new Error('No isochrone data returned');
    }

    return data;

  } catch (error) {
    console.error('[Mapbox Isochrone] Error:', error);
    throw error;
  }
}
