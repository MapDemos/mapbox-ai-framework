/**
 * Map Controller
 * Manages Mapbox GL JS map and integrates with Mapbox Map Tools MCP library
 */

import mapboxgl from 'mapbox-gl';
import { geocodeLocation, reverseGeocode, getDirections, searchLocation, getIsochrone, getTravelTimeMatrix } from './mapbox-service-utils.js';

export class MapController {
  constructor(config, app = null) {
    this.config = config;
    this.app = app; // Reference to main app for accessing search history
    this.map = null;
    this.mapTools = null;
    this.markers = [];
    this.userLocationMarker = null;
    this.routes = []; // Track all routes with their layers and markers
    this.isochrones = []; // Track all isochrone layers
    this.starMarkers = []; // Track star markers for recommended POIs
    this.languageControl = null; // Mapbox GL Language plugin
    this.geolocateControl = null; // Mapbox built-in geolocation control
    this.eventHandlers = []; // Track all event listeners for cleanup
    this.domEventHandlers = []; // Track DOM event listeners
  }

  /**
   * Initialize the map
   * @param {string} containerId - ID of the container element
   */
  async initialize(containerId) {
    try {
      // Set Mapbox access token
      mapboxgl.accessToken = this.config.MAPBOX_ACCESS_TOKEN;

      // Create map
      this.map = new mapboxgl.Map({
        container: containerId,
        //style: this.config.MAP_STYLE, // Commented out to use default 3D style
        center: this.config.DEFAULT_MAP_CENTER,
        zoom: this.config.DEFAULT_MAP_ZOOM,
        attributionControl: true,
        projection: 'mercator',
        // Restrict map bounds to Japan (southwest: [lng, lat], northeast: [lng, lat])
        maxBounds: [[122, 24], [154, 46]]
      });

      // Add navigation controls
      this.map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      // Add fullscreen control
      this.map.addControl(new mapboxgl.FullscreenControl(), 'top-right');

      // Add Geolocate control with custom styling for puck
      this.geolocateControl = new mapboxgl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true
        },
        trackUserLocation: true,
        showUserHeading: false,
        showAccuracyCircle: true
      });
      this.map.addControl(this.geolocateControl, 'top-right');

      // Wait for map to load
      await new Promise((resolve) => {
        this.map.on('load', resolve);
      });

      // Initialize Map Tools library (loaded from CDN)
      // The MapboxMapTools class should be available globally from the CDN script
      if (typeof MapboxMapTools !== 'undefined') {
        this.mapTools = new MapboxMapTools(this.map, {
          enablePopups: false,
          enableHoverEffects: true
        });
      } else {
        console.warn('MapboxMapTools not found. Make sure the CDN script is loaded.');
      }

      return true;
    } catch (error) {
      console.error('Failed to initialize Map Controller:', error);
      throw new Error(`Map initialization failed: ${error.message}`);
    }
  }

  /**
   * Get tools formatted for Claude API
   * Overrides the add_points_to_map tool to accept GeoJSON format
   */
  getToolsForClaude() {
    if (!this.mapTools) {
      console.warn('Map Tools not initialized');
      return [];
    }

    try {
      const tools = this.mapTools.getToolsForLLM();

      // Filter out deprecated tools and modify others
      const modifiedTools = tools
        .filter(tool => tool.name !== 'add_route_to_map') // Remove deprecated tool
        .map(tool => {
        if (tool.name === 'add_points_to_map') {
          // Return a modified version that accepts GeoJSON
          return {
            name: 'add_points_to_map',
            description: 'Add point markers to the map from GeoJSON FeatureCollection. Use this tool when users want to show specific locations, places of interest, or mark important spots on the map.',
            input_schema: {
              type: 'object',
              properties: {
                geojson: {
                  type: 'object',
                  description: 'GeoJSON FeatureCollection with features to display on the map. Each feature should have geometry.coordinates [lng, lat] and properties (name, address, tel, time, price, rank, photo, summary)',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['FeatureCollection']
                    },
                    features: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          type: {
                            type: 'string',
                            enum: ['Feature']
                          },
                          geometry: {
                            type: 'object',
                            properties: {
                              type: {
                                type: 'string',
                                enum: ['Point']
                              },
                              coordinates: {
                                type: 'array',
                                items: { type: 'number' },
                                minItems: 2,
                                maxItems: 2
                              }
                            },
                            required: ['type', 'coordinates']
                          },
                          properties: {
                            type: 'object',
                            description: 'Feature properties including name, address, tel, time, price, rank, photo, summary'
                          }
                        },
                        required: ['type', 'geometry', 'properties']
                      }
                    }
                  },
                  required: ['type', 'features']
                },
                layerName: {
                  type: 'string',
                  description: 'Optional name for the points layer'
                }
              },
              required: ['geojson']
            }
          };
        }
        return tool;
      });

      // Add Mapbox service tools (geocoding, etc.)
      modifiedTools.push(
        {
          name: 'geocode_location',
          description: 'Convert a location name or address to geographic coordinates (latitude/longitude). Supports locations worldwide, with enhanced support for Japan. Returns coordinates, place name, and address information.',
          input_schema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'Location name or address to geocode (e.g., "Tokyo Tower", "Shibuya", "東京タワー")'
              },
              country: {
                type: 'string',
                description: 'Optional: Restrict results to a country (ISO 3166-1 alpha-2 code, e.g., "JP" for Japan)'
              },
              limit: {
                type: 'number',
                description: 'Optional: Maximum number of results to return (default: 1)',
                default: 1
              }
            },
            required: ['location']
          }
        },
        {
          name: 'reverse_geocode',
          description: 'Convert geographic coordinates (latitude/longitude) to a human-readable address or place name. Returns detailed location information including address, place name, and administrative regions.',
          input_schema: {
            type: 'object',
            properties: {
              longitude: {
                type: 'number',
                description: 'Longitude coordinate (-180 to 180)'
              },
              latitude: {
                type: 'number',
                description: 'Latitude coordinate (-90 to 90)'
              },
              types: {
                type: 'string',
                description: 'Optional: Comma-separated types of results to return (e.g., "address,place,locality")'
              }
            },
            required: ['longitude', 'latitude']
          }
        },
        {
          name: 'get_directions',
          description: 'Get turn-by-turn directions and a route between multiple locations using Mapbox Directions API. Returns the route geometry as GeoJSON, distance, duration, and step-by-step instructions. Use this tool when users want to draw routes, get directions, or plan trips between locations.',
          input_schema: {
            type: 'object',
            properties: {
              waypoints: {
                type: 'array',
                description: 'Array of waypoint coordinates in [longitude, latitude] format. Minimum 2 waypoints, maximum 25.',
                items: {
                  type: 'array',
                  items: { type: 'number' },
                  minItems: 2,
                  maxItems: 2
                },
                minItems: 2,
                maxItems: 25
              },
              profile: {
                type: 'string',
                description: 'Routing profile: "driving" (default), "walking", "cycling", or "driving-traffic"',
                enum: ['driving', 'walking', 'cycling', 'driving-traffic'],
                default: 'driving'
              },
              alternatives: {
                type: 'boolean',
                description: 'Whether to return alternative routes (default: false)',
                default: false
              },
              steps: {
                type: 'boolean',
                description: 'Whether to return turn-by-turn instructions (default: true)',
                default: true
              },
              language: {
                type: 'string',
                description: 'Language code for instructions (e.g., "en", "ja")',
                default: 'en'
              }
            },
            required: ['waypoints']
          }
        },
        {
          name: 'search_location',
          description: 'Search for INFRASTRUCTURE locations using Mapbox SearchBox API (NOT for tourism POIs). USE THIS TOOL ONLY when: (1) search_rurubu_pois returns 0 results, OR (2) user asks for non-tourism infrastructure like hospitals, stations, hotels, convenience stores, banks, parking. ⚠️ NEVER use for restaurants/cafes/temples - use search_rurubu_pois instead. Results are AUTOMATICALLY displayed on map with icons. Returns BASIC data only (name, coordinates, category - NO prices, NO hours, NO ratings). Can find: hospitals (病院), stations (駅), hotels (ホテル), convenience stores (コンビニ), banks (銀行), parking (駐車場). IMPORTANT: Always translate to Japanese (e.g., "Shibuya Station" → "渋谷駅", "hospitals" → "病院").',
          input_schema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query in JAPANESE. Examples: "横浜市 病院" (hospitals in Yokohama), "渋谷 コンビニ" (convenience stores in Shibuya), "東京タワー" (Tokyo Tower), "京都駅" (Kyoto Station). Always translate English to Japanese.'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 5)',
                default: 5
              }
            },
            required: ['query']
          }
        },
        {
          name: 'hide_all_routes',
          description: 'Hide all routes from the map. Use when user asks to hide routes or clear the map of routes.',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'show_all_routes',
          description: 'Show all previously hidden routes on the map. Use when user asks to show routes again.',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'clear_all_routes',
          description: 'Permanently remove all routes from the map and memory. Use when user asks to clear or delete all routes.',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'get_isochrone',
          description: 'Get reachable areas (isochrone) from a location within specified time or distance. Shows polygons representing areas reachable by driving, walking, or cycling. Use when user asks "what can I reach within X minutes" or "show me 30-minute reachable area".',
          input_schema: {
            type: 'object',
            properties: {
              coordinates: {
                type: 'array',
                description: 'Starting point coordinates in [longitude, latitude] format',
                items: { type: 'number' },
                minItems: 2,
                maxItems: 2
              },
              contours_minutes: {
                type: 'array',
                description: 'Time contours in minutes (1-60). Up to 4 values in increasing order (e.g., [10, 20, 30])',
                items: { type: 'number', minimum: 1, maximum: 60 },
                minItems: 1,
                maxItems: 4
              },
              profile: {
                type: 'string',
                description: 'Travel mode: "driving" (default), "walking", "cycling", or "driving-traffic"',
                enum: ['driving', 'walking', 'cycling', 'driving-traffic'],
                default: 'driving'
              },
              colors: {
                type: 'array',
                description: 'Optional: Hex colors for each contour (without # prefix). Must match contours_minutes length',
                items: { type: 'string' }
              }
            },
            required: ['coordinates', 'contours_minutes']
          }
        },
        {
          name: 'get_travel_time_matrix',
          description: 'Calculate travel times and distances between multiple locations using Mapbox Matrix API. Returns a matrix showing duration (in seconds) and distance (in meters) from each origin to each destination. Perfect for comparing travel times between multiple POIs, finding the closest location, or optimizing multi-stop routes. Use when user asks "how long to get from A to B", "which is closest", or "compare travel times between these places".',
          input_schema: {
            type: 'object',
            properties: {
              coordinates: {
                type: 'array',
                description: 'Array of location coordinates in [longitude, latitude] format. Minimum 2 locations, maximum 25. By default, calculates travel time from each location to all other locations.',
                items: {
                  type: 'array',
                  items: { type: 'number' },
                  minItems: 2,
                  maxItems: 2
                },
                minItems: 2,
                maxItems: 25
              },
              profile: {
                type: 'string',
                description: 'Routing profile: "driving" (default), "walking", "cycling", or "driving-traffic"',
                enum: ['driving', 'walking', 'cycling', 'driving-traffic'],
                default: 'driving'
              },
              sources: {
                description: 'Optional: Indices of coordinates to use as sources (origins). Can be array of numbers [0,1,2] or "all". If omitted, all coordinates are used as sources.',
                oneOf: [
                  { type: 'string', enum: ['all'] },
                  { type: 'array', items: { type: 'number' } }
                ]
              },
              destinations: {
                description: 'Optional: Indices of coordinates to use as destinations. Can be array of numbers [0,1,2] or "all". If omitted, all coordinates are used as destinations.',
                oneOf: [
                  { type: 'string', enum: ['all'] },
                  { type: 'array', items: { type: 'number' } }
                ]
              },
              annotations: {
                type: 'array',
                description: 'Data to include in response: "duration" (seconds), "distance" (meters). Default: both',
                items: {
                  type: 'string',
                  enum: ['duration', 'distance']
                },
                default: ['duration', 'distance']
              }
            },
            required: ['coordinates']
          }
        },
        {
          name: 'hide_all_isochrones',
          description: 'Hide all isochrones from the map. Use when user asks to hide isochrones or clear the map of isochrone polygons.',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'show_all_isochrones',
          description: 'Show all previously hidden isochrones on the map. Use when user asks to show isochrones again.',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'clear_all_isochrones',
          description: 'Permanently remove all isochrones from the map and memory. Use when user asks to clear or delete all isochrones.',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'get_all_map_pois',
          description: 'Get all POIs currently visible on the map, grouped by location. Use this when user asks to plan a trip across multiple locations that have already been searched (e.g., "plan my trip in Asakusa and Shibuya" after searching both locations). Returns essential POI details including name, category, coordinates, and rating for each location group.',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'clear_all_markers',
          description: 'Remove all markers from the map (including points added via add_points_to_map and star markers). Use when user asks to clear, remove, or delete all markers.',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'highlight_recommended_pois',
          description: 'Add star markers to highlight recommended POIs on the map. ALWAYS call this BEFORE writing your response. For primary recommendations, POIs are numbered (1,2,3...) in order provided. For alternatives (when user asks "other options?"), set are_alternatives=true to show "-" instead of numbers. CRITICAL: Use exact data from get_poi_summary - include "id" field (mandatory for Rurubu POIs, ensures 99% match rate), exact "name" (no translation/shortening), and full-precision "coordinates". ID matching has 99% success rate vs 50% for name-only matching.',
          input_schema: {
            type: 'object',
            properties: {
              pois: {
                type: 'array',
                description: 'Array of POI objects with optional id, name, and coordinates',
                items: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                      description: 'POI ID (preferred for accurate matching)'
                    },
                    name: {
                      type: 'string',
                      description: 'POI name'
                    },
                    coordinates: {
                      type: 'array',
                      description: 'Coordinates as [longitude, latitude]',
                      items: {
                        type: 'number'
                      },
                      minItems: 2,
                      maxItems: 2
                    }
                  },
                  required: ['name', 'coordinates']
                }
              },
              are_alternatives: {
                type: 'boolean',
                description: 'Set to true when showing alternatives (user asked "other options?"). This displays "-" instead of numbers. Default: false (show numbers 1,2,3...)',
                default: false
              }
            },
            required: ['pois']
          }
        },
        {
          name: 'draw_itinerary_route',
          description: 'Draw a route on the map with directional arrows showing an itinerary path through multiple locations. Perfect for day trips, tours, and multi-stop routes. The route will appear as a colored line with arrows indicating the direction of travel. Use this when planning itineraries or showing the order to visit multiple places.',
          input_schema: {
            type: 'object',
            properties: {
              waypoints: {
                type: 'array',
                description: 'Array of waypoint coordinates in order of visit. Format: [[lng1, lat1], [lng2, lat2], ...]. Minimum 2 waypoints.',
                items: {
                  type: 'array',
                  items: { type: 'number' },
                  minItems: 2,
                  maxItems: 2
                },
                minItems: 2
              },
              profile: {
                type: 'string',
                description: 'Travel mode: "walking" (default for city exploration), "cycling", or "driving"',
                enum: ['walking', 'cycling', 'driving'],
                default: 'walking'
              },
              color: {
                type: 'string',
                description: 'Route color in hex format (default: "#9C27B0" purple)',
                default: '#9C27B0'
              }
            },
            required: ['waypoints']
          }
        },
        {
          name: 'add_visit_order_markers',
          description: 'Add numbered markers (1, 2, 3...) to show the order to visit locations in an itinerary. Use this TOGETHER with draw_itinerary_route to show both the route AND the visit sequence. The numbers help users understand which place to visit first, second, etc.',
          input_schema: {
            type: 'object',
            properties: {
              locations: {
                type: 'array',
                description: 'Array of locations in visit order with their names and coordinates',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Location/POI name to show in popup'
                    },
                    coordinates: {
                      type: 'array',
                      description: 'Coordinates as [longitude, latitude]',
                      items: { type: 'number' },
                      minItems: 2,
                      maxItems: 2
                    },
                    label: {
                      type: 'string',
                      description: 'Optional: Custom label for marker (default: sequential numbers 1, 2, 3...)'
                    }
                  },
                  required: ['name', 'coordinates']
                }
              },
              color: {
                type: 'string',
                description: 'Marker background color in hex format (default: "#1976d2" blue)',
                default: '#1976d2'
              }
            },
            required: ['locations']
          }
        }
      );

      return modifiedTools;
    } catch (error) {
      console.error('Error getting map tools:', error);
      return [];
    }
  }

  /**
   * Execute a map tool
   * @param {string} toolName - Name of the tool
   * @param {object} args - Tool arguments
   */
  async executeTool(toolName, args) {
    try {
      // Handle Mapbox service tools
      if (toolName === 'geocode_location') {
        return await this.executeGeocode(args);
      }

      if (toolName === 'reverse_geocode') {
        return await this.executeReverseGeocode(args);
      }

      if (toolName === 'get_directions') {
        return await this.executeGetDirections(args);
      }

      if (toolName === 'search_location') {
        return await this.executeSearchLocation(args);
      }

      if (toolName === 'get_isochrone') {
        return await this.executeGetIsochrone(args);
      }

      if (toolName === 'get_travel_time_matrix') {
        return await this.executeGetTravelTimeMatrix(args);
      }

      if (toolName === 'hide_all_routes') {
        this.hideAllRoutes();
        return {
          content: [{
            type: 'text',
            text: 'All routes have been hidden from the map.'
          }]
        };
      }

      if (toolName === 'show_all_routes') {
        this.showAllRoutes();
        return {
          content: [{
            type: 'text',
            text: 'All routes are now visible on the map.'
          }]
        };
      }

      if (toolName === 'clear_all_routes') {
        this.clearAllRoutes();
        return {
          content: [{
            type: 'text',
            text: 'All routes have been cleared from the map.'
          }]
        };
      }

      if (toolName === 'hide_all_isochrones') {
        this.hideAllIsochrones();
        return {
          content: [{
            type: 'text',
            text: 'All isochrones have been hidden from the map.'
          }]
        };
      }

      if (toolName === 'show_all_isochrones') {
        this.showAllIsochrones();
        return {
          content: [{
            type: 'text',
            text: 'All isochrones are now visible on the map.'
          }]
        };
      }

      if (toolName === 'clear_all_isochrones') {
        this.clearAllIsochrones();
        return {
          content: [{
            type: 'text',
            text: 'All isochrones have been cleared from the map.'
          }]
        };
      }

      if (toolName === 'get_all_map_pois') {
        return await this.executeGetAllMapPois(args);
      }

      // get_visible_pois removed - use get_poi_summary instead

      if (toolName === 'clear_all_markers') {
        // Clear all DOM markers
        this.markers.forEach(marker => marker.remove());
        this.markers = [];

        // Clear star markers
        this.clearStarMarkers();

        return {
          content: [{
            type: 'text',
            text: 'All markers have been removed from the map.'
          }]
        };
      }

      if (toolName === 'highlight_recommended_pois') {
        return await this.executeHighlightRecommendedPOIs(args);
      }

      if (toolName === 'draw_itinerary_route') {
        return await this.executeDrawItineraryRoute(args);
      }

      if (toolName === 'add_visit_order_markers') {
        return await this.executeAddVisitOrderMarkers(args);
      }

      // Handle map visualization tools
      if (!this.mapTools) {
        throw new Error('Map Tools not initialized');
      }

      // Intercept add_route_to_map and redirect to get_directions
      if (toolName === 'add_route_to_map') {
        console.warn('[Map Tools] add_route_to_map is deprecated. Use get_directions instead.');
        return {
          content: [{
            type: 'text',
            text: 'Error: add_route_to_map is deprecated. Please use the get_directions tool instead. First geocode your location names to coordinates, then call get_directions with an array of waypoints in [longitude, latitude] format.'
          }],
          isError: true
        };
      }

      // Transform GeoJSON format to points format for add_points_to_map
      if (toolName === 'add_points_to_map') {
        args = this.transformGeoJSONToPoints(args);

        // Safety check: if args still doesn't have points, create an empty array
        if (!args.points || !Array.isArray(args.points)) {
          return {
            content: [{
              type: 'text',
              text: 'Error: Unable to display points on map. The data format was not recognized.'
            }],
            isError: true
          };
        }

        // Use custom marker implementation instead of circles
        return await this.executeAddPointsAsMarkers(args);
      }

      let result;
      try {
        result = await this.mapTools.executeTool(toolName, args);
      } catch (error) {
        // Handle Mapbox GL JS errors (e.g., source removal while layer is using it)
        if (error.message && error.message.includes('cannot be removed while layer')) {
          console.warn('[WARN] Mapbox layer/source cleanup error (non-critical):', error.message);
          // Return success - the map layers are being cleared anyway
          return {
            content: [{
              type: 'text',
              text: `Tool ${toolName} completed with cleanup warnings (map state reset).`
            }]
          };
        }
        // Re-throw other errors
        throw error;
      }

      // Validate that result has non-empty content (Claude API requirement)
      if (!result || !result.content || result.content.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `Tool ${toolName} completed successfully.`
          }]
        };
      }

      // Check if content items are empty
      const hasEmptyContent = result.content.some(item =>
        !item.text || item.text.trim() === ''
      );

      if (hasEmptyContent) {
        return {
          content: [{
            type: 'text',
            text: `Tool ${toolName} completed successfully.`
          }]
        };
      }

      return result;
    } catch (error) {
      console.error(`[Map Tools] Error executing ${toolName}:`, error);
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
   * Execute geocode_location tool
   */
  async executeGeocode(args) {
    const { location, country, limit } = args;

    const options = {};
    if (country) options.country = country;
    if (limit) options.limit = limit.toString();

    // @ts-expect-error - geocodeLocation is async and returns Promise, await is necessary
    const result = await geocodeLocation(location, this.config.MAPBOX_ACCESS_TOKEN, options);

    if (!result) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            location: location,
            message: `No geocoding results found for: ${location}`
          }, null, 2)
        }]
      };
    }

    // Format the response (v6 format)
    const props = result.properties || {};
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          location: location,
          coordinates: result.geometry?.coordinates || null,
          name: props.name || null,
          full_address: props.full_address || null,
          place_formatted: props.place_formatted || null,
          mapbox_id: props.mapbox_id || null,
          feature_type: props.feature_type || null,
          match_code: props.match_code || null,
          context: props.context || null,
          bbox: result.bbox || null
        }, null, 2)
      }]
    };
  }

  /**
   * Execute reverse_geocode tool
   */
  async executeReverseGeocode(args) {
    const { longitude, latitude, types } = args;

    const options = {};
    if (types) options.types = types;

    // @ts-ignore - reverseGeocode is async and returns Promise, await is necessary
    const result = await reverseGeocode(longitude, latitude, this.config.MAPBOX_ACCESS_TOKEN, options);

    if (!result) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            coordinates: [longitude, latitude],
            message: `No reverse geocoding results found for coordinates: [${longitude}, ${latitude}]`
          }, null, 2)
        }]
      };
    }

    // Format the response (v6 format)
    const props = result.properties || {};
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          coordinates: [longitude, latitude],
          name: props.name || null,
          full_address: props.full_address || null,
          place_formatted: props.place_formatted || null,
          mapbox_id: props.mapbox_id || null,
          feature_type: props.feature_type || null,
          context: props.context || null
        }, null, 2)
      }]
    };
  }

  /**
   * Execute get_all_map_pois tool - Get all visible POIs grouped by location
   */
  async executeGetAllMapPois() {
    if (!this.app) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'App reference not available in MapController'
          }, null, 2)
        }],
        isError: true
      };
    }

    try {
      const locationGroups = this.app.getAllSearchPOIs();

      if (!locationGroups || locationGroups.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'No POIs currently visible on the map',
              location_groups: []
            }, null, 2)
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            total_locations: locationGroups.length,
            total_pois: locationGroups.reduce((sum, group) => sum + group.pois.length, 0),
            location_groups: locationGroups
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message
          }, null, 2)
        }],
        isError: true
      };
    }
  }


  /**
   * Get emoji icon for POI category
   * @param {string} category - POI category (see, play, eat, cafe, nightlife, buy, onsen, other)
   * @returns {string} Emoji icon
   */
  getPOICategoryIcon(category) {
    const iconMap = {
      see: '👁️',        // Sightseeing / Tourism
      play: '🎮',       // Entertainment / Activities
      eat: '🍽️',       // Restaurants / Dining
      cafe: '☕',       // Cafes / Tea houses
      nightlife: '🍺',  // Bars / Nightlife
      buy: '🛍️',       // Shopping
      onsen: '♨️',      // Hot springs
      other: '📍'       // Miscellaneous
    };

    return iconMap[category] || iconMap.other;
  }

  /**
   * Official Mapbox icon identifier to emoji mapping
   * Based on Mapbox Category API: https://api.mapbox.com/search/v1/list/category
   * @private
   */
  MAPBOX_ICON_TO_EMOJI = {
    // Food & Drink
    'restaurant': { emoji: '🍽️', color: '#FF5722' },
    'restaurant-noodle': { emoji: '🍜', color: '#FF5722' },
    'restaurant-pizza': { emoji: '🍕', color: '#FF5722' },
    'restaurant-seafood': { emoji: '🐟', color: '#FF5722' },
    'restaurant-sushi': { emoji: '🍣', color: '#FF5722' },
    'cafe': { emoji: '☕', color: '#795548' },
    'bar': { emoji: '🍺', color: '#9C27B0' },
    'fast-food': { emoji: '🍔', color: '#FF9800' },
    'bakery': { emoji: '🥐', color: '#F4B400' },
    'confectionery': { emoji: '🍰', color: '#E91E63' },
    'ice-cream': { emoji: '🍦', color: '#E91E63' },

    // Tourism & Attractions
    'attraction': { emoji: '🗼', color: '#E91E63' },
    'museum': { emoji: '🏛️', color: '#9C27B0' },
    'art-gallery': { emoji: '🎨', color: '#673AB7' },
    'castle': { emoji: '🏯', color: '#9C27B0' },
    'religious-shinto': { emoji: '⛩️', color: '#9C27B0' },
    'religious-buddhist': { emoji: '🛕', color: '#9C27B0' },
    'religious-christian': { emoji: '⛪', color: '#9C27B0' },
    'religious-muslim': { emoji: '🕌', color: '#9C27B0' },

    // Entertainment
    'amusement-park': { emoji: '🎢', color: '#FF9800' },
    'park': { emoji: '🌳', color: '#4CAF50' },
    'garden': { emoji: '🏞️', color: '#4CAF50' },
    'zoo': { emoji: '🦁', color: '#4CAF50' },
    'aquarium': { emoji: '🐠', color: '#2196F3' },
    'theatre': { emoji: '🎭', color: '#9C27B0' },
    'cinema': { emoji: '🎬', color: '#9C27B0' },
    'nightclub': { emoji: '💃', color: '#E91E63' },
    'karaoke': { emoji: '🎤', color: '#FF9800' },
    'casino': { emoji: '🎰', color: '#FFC107' },

    // Shopping
    'shop': { emoji: '🛍️', color: '#2196F3' },
    'grocery': { emoji: '🛒', color: '#4CAF50' },
    'convenience': { emoji: '🏪', color: '#2196F3' },
    'clothing-store': { emoji: '👔', color: '#E91E63' },
    'shoe': { emoji: '👟', color: '#E91E63' },
    'furniture': { emoji: '🛋️', color: '#795548' },
    'florist': { emoji: '💐', color: '#E91E63' },
    'hardware': { emoji: '🔧', color: '#607D8B' },
    'mobile-phone': { emoji: '📱', color: '#2196F3' },
    'watch': { emoji: '⌚', color: '#795548' },
    'alcohol-shop': { emoji: '🍷', color: '#9C27B0' },
    'beer': { emoji: '🍺', color: '#9C27B0' },

    // Accommodation
    'lodging': { emoji: '🏨', color: '#4CAF50' },
    'campsite': { emoji: '⛺', color: '#4CAF50' },

    // Transportation
    'rail': { emoji: '🚃', color: '#2196F3' },
    'rail-metro': { emoji: '🚇', color: '#2196F3' },
    'bus': { emoji: '🚌', color: '#2196F3' },
    'airport': { emoji: '✈️', color: '#2196F3' },
    'parking': { emoji: '🅿️', color: '#607D8B' },
    'taxi': { emoji: '🚕', color: '#FFC107' },
    'ferry': { emoji: '⛴️', color: '#2196F3' },
    'fuel': { emoji: '⛽', color: '#607D8B' },
    'car-rental': { emoji: '🚗', color: '#4CAF50' },
    'charging-station': { emoji: '🔌', color: '#4CAF50' },

    // Healthcare
    'hospital': { emoji: '🏥', color: '#F44336' },
    'hospital-JP': { emoji: '🏥', color: '#F44336' },
    'doctor': { emoji: '⚕️', color: '#F44336' },
    'dentist': { emoji: '🦷', color: '#F44336' },
    'pharmacy': { emoji: '💊', color: '#F44336' },
    'optician': { emoji: '👓', color: '#F44336' },

    // Services
    'bank': { emoji: '🏦', color: '#607D8B' },
    'post': { emoji: '📮', color: '#FF5722' },
    'police': { emoji: '👮', color: '#2196F3' },
    'fire-station': { emoji: '🚒', color: '#F44336' },
    'library': { emoji: '📚', color: '#795548' },
    'school': { emoji: '🏫', color: '#2196F3' },
    'college-JP': { emoji: '🎓', color: '#2196F3' },
    'town-hall': { emoji: '🏛️', color: '#607D8B' },
    'embassy': { emoji: '🏛️', color: '#607D8B' },
    'laundry': { emoji: '🧺', color: '#2196F3' },

    // Sports
    'stadium': { emoji: '🏟️', color: '#4CAF50' },
    'fitness-centre': { emoji: '💪', color: '#FF9800' },
    'swimming': { emoji: '🏊', color: '#2196F3' },
    'baseball': { emoji: '⚾', color: '#4CAF50' },
    'basketball': { emoji: '🏀', color: '#FF9800' },
    'soccer': { emoji: '⚽', color: '#4CAF50' },
    'tennis': { emoji: '🎾', color: '#4CAF50' },
    'golf': { emoji: '⛳', color: '#4CAF50' },
    'skiing': { emoji: '⛷️', color: '#2196F3' },
    'bowling-alley': { emoji: '🎳', color: '#9C27B0' },
    'horse-riding': { emoji: '🐴', color: '#795548' },
    'racetrack-horse': { emoji: '🏇', color: '#795548' },

    // Nature & Outdoors
    'hot-spring': { emoji: '♨️', color: '#FF5722' },
    'harbor': { emoji: '⚓', color: '#2196F3' },
    'water': { emoji: '💧', color: '#2196F3' },
    'cemetery': { emoji: '⚰️', color: '#607D8B' },

    // Commercial
    'commercial': { emoji: '🏢', color: '#607D8B' },
    'building-alt1': { emoji: '🏢', color: '#607D8B' },
    'warehouse': { emoji: '🏭', color: '#607D8B' },
    'home': { emoji: '🏠', color: '#4CAF50' },

    // Miscellaneous
    'suitcase': { emoji: '🧳', color: '#9C27B0' },
    'information': { emoji: 'ℹ️', color: '#2196F3' },
    'bicycle': { emoji: '🚴', color: '#4CAF50' },
    'bicycle-share': { emoji: '🚲', color: '#4CAF50' },
    'gaming': { emoji: '🎮', color: '#9C27B0' },
    'music': { emoji: '🎵', color: '#9C27B0' },
    'recycling': { emoji: '♻️', color: '#4CAF50' },
    'slaughterhouse': { emoji: '🏭', color: '#607D8B' },
    'highway-rest-area': { emoji: '🚻', color: '#607D8B' },
    'hairdresser': { emoji: '💇', color: '#E91E63' }
  };

  /**
   * Get emoji icon for Mapbox SearchBox POI
   * Priority: maki field > poi_category > default
   * @param {string} maki - Mapbox maki icon identifier (e.g., "restaurant-15")
   * @param {Array|string} poiCategory - POI category or array of categories from SearchBox
   * @returns {Object} Icon emoji and color
   */
  getSearchBoxIcon(maki = null, poiCategory = null) {
    // Priority 1: Use maki field if available (most reliable - exact Mapbox icon)
    if (maki && maki !== 'marker') {  // Skip generic "marker" fallback
      // Extract base icon name from maki (e.g., "restaurant-15" -> "restaurant")
      const iconName = maki.replace(/-\d+$/, ''); // Remove trailing -NN suffix

      if (this.MAPBOX_ICON_TO_EMOJI[iconName]) {
        return this.MAPBOX_ICON_TO_EMOJI[iconName];
      }
    }

    // Priority 2: Try to match poi_category
    if (poiCategory) {
      const categories = Array.isArray(poiCategory) ? poiCategory : [poiCategory];
      const primaryCategory = categories[0]?.toLowerCase().replace(/\s+/g, '-') || '';

      // Try exact match first
      if (this.MAPBOX_ICON_TO_EMOJI[primaryCategory]) {
        return this.MAPBOX_ICON_TO_EMOJI[primaryCategory];
      }

      // Special handling for healthcare categories
      if (primaryCategory.includes('hospital') || primaryCategory.includes('medical') ||
          primaryCategory.includes('health') || primaryCategory.includes('clinic')) {
        return this.MAPBOX_ICON_TO_EMOJI['hospital'];
      }

      // Try partial matches (e.g., "sushi restaurant" might contain "restaurant")
      // Only match if category contains the icon name (not vice versa) to avoid false positives
      for (const [iconName, iconData] of Object.entries(this.MAPBOX_ICON_TO_EMOJI)) {
        if (primaryCategory.includes(iconName)) {
          return iconData;
        }
      }
    }

    // Default fallback
    return { emoji: '📍', color: '#607D8B' };
  }

  /**
   * Execute add_points_to_map using DOM markers instead of circles
   *
   * REVERT INSTRUCTIONS: To revert to simple default markers:
   * 1. Replace the marker creation code in the forEach loop with:
   *    const marker = new mapboxgl.Marker({ color: color || '#FF0000' })
   *      .setLngLat([longitude, latitude]);
   * 2. Uncomment the old popup code
   * 3. Remove the custom wrapper and pill marker element creation
   */
  async executeAddPointsAsMarkers(args) {
    const { points } = args;

    if (!points || !Array.isArray(points) || points.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No points to display'
        }],
        isError: true
      };
    }

    try {
      // Add marker for each point
      points.forEach(point => {
        const { longitude, latitude, title, description, category, rank, poi_category, maki } = point;

        // Get emoji icon and color based on category
        // Priority: SearchBox maki/poi_category > Rurubu category > default
        let icon, bgColor;
        if (maki || poi_category) {
          // Use SearchBox POI data for more specific icons
          const searchBoxIcon = this.getSearchBoxIcon(maki, poi_category);
          icon = searchBoxIcon.emoji;
          bgColor = searchBoxIcon.color;
        } else if (category) {
          // Fallback to Rurubu category
          icon = this.getPOICategoryIcon(category);
          bgColor = this.getCategoryColor(category);
        } else {
          // Default
          icon = '📍';
          bgColor = '#607D8B';
        }

        // Format ranking (A-D or empty)
        const ranking = rank ? rank.toString().toUpperCase() : '';
        const rankClass = ranking ? `rank-${ranking.toLowerCase()}` : '';

        // Create wrapper for Mapbox positioning (0x0 div)
        const wrapper = document.createElement('div');
        wrapper.style.width = '0px';
        wrapper.style.height = '0px';
        wrapper.style.position = 'relative';

        // Create pill marker element
        const markerEl = document.createElement('div');
        markerEl.className = 'poi-pill-marker';

        // Position to center the pill on the POI location
        markerEl.style.position = 'absolute';
        markerEl.style.left = '-35px'; // Adjusted for larger size
        markerEl.style.top = '-16px';  // Adjusted for larger size

        // Add icon with colored background
        const iconEl = document.createElement('div');
        iconEl.className = 'poi-pill-icon';
        iconEl.style.cssText = `background: ${bgColor} !important;`;
        iconEl.textContent = icon;
        markerEl.appendChild(iconEl);

        // Add ranking if available
        if (ranking) {
          const rankingEl = document.createElement('div');
          rankingEl.className = `poi-pill-ranking ${rankClass}`;
          rankingEl.textContent = ranking;
          markerEl.appendChild(rankingEl);
        }

        // Add marker element to wrapper
        wrapper.appendChild(markerEl);

        // Create Mapbox GL JS marker with custom element (no popup, using modal instead)
        const marker = new mapboxgl.Marker({
          element: wrapper,
          anchor: 'center'
        })
          .setLngLat([longitude, latitude]);

        // Add click handler to show POI modal
        markerEl.addEventListener('click', () => {
          if (this.poiClickCallback) {
            this.poiClickCallback(point);
          }
        });

        // Add to map
        marker.addTo(this.map);

        // Store marker for cleanup
        this.markers.push(marker);
      });

      // Fit map to show all points
      if (points.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        points.forEach(point => {
          bounds.extend([point.longitude, point.latitude]);
        });
        this.map.fitBounds(bounds, { padding: 50, duration: 1000 });
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Added ${points.length} markers to the map`,
            points_count: points.length
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  /**
   * Execute highlight_recommended_pois tool - Add star markers to recommended POIs
   * Accepts POI objects with name and coordinates
   */
  async executeHighlightRecommendedPOIs(args) {
    const { pois, are_alternatives = false } = args;

    if (!pois || !Array.isArray(pois) || pois.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'No POIs provided to highlight'
          }, null, 2)
        }],
        isError: true
      };
    }

    try {
      // Clear existing star markers
      this.clearStarMarkers();

      // Clear all waypoint numbers from base markers to prevent number confusion
      // When starring recommendations, we want fresh 1,2,3... numbers, not old itinerary waypoints
      this.clearAllWaypointNumbers();

      // Track which base markers to hide
      if (!this.hiddenBaseMarkers) {
        this.hiddenBaseMarkers = [];
      }

      // Track POIs that couldn't be found (for error reporting)
      const notFoundPOIs = [];

      // Add star marker for each POI
      pois.forEach((poi, index) => {
        try {
          const { id, name, coordinates } = poi;
          const [lng, lat] = coordinates;
          const recommendationNumber = index + 1; // 1-based numbering

        // PRIORITY: Look up POI data from app.poiDataStore first (most reliable)
        // This allows starring to work even when base markers aren't on the map
        let poiData = null;

        if (this.app?.poiDataStore) {
          // Try to find by ID first (most reliable)
          if (id) {
            for (const [storeName, storeData] of this.app.poiDataStore.entries()) {
              if (String(storeData.id) === String(id)) {
                poiData = storeData;
                break;
              }
            }
          }
          // Fall back to name lookup if ID didn't match
          if (!poiData && name) {
            poiData = this.app.poiDataStore.get(name);
          }
        }

        // CRITICAL: If POI not found in store, skip it (don't create marker with empty data)
        if (!poiData) {
          console.error('[ERROR] POI not found in poiDataStore - skipping:', { id, name, coordinates });
          notFoundPOIs.push({ index: index + 1, name, id });
          return; // Skip this POI
        }

        // SECONDARY: If found in store, try to find and hide matching base marker
        // (This is optional - starring works without base markers)
        if (poiData && this.layerMarkers) {
          outerLoop: for (const markers of this.layerMarkers.values()) {
            for (const markerObj of markers) {
              let isMatch = false;

              // Skip SearchBox POIs
              if (markerObj.props?.source === 'searchbox') {
                continue;
              }

              // Try to match this base marker with our POI
              // Priority 1: Match by ID
              if (poiData.id && markerObj.props?.id && String(markerObj.props.id) === String(poiData.id)) {
                isMatch = true;
              }
              // Priority 2: Match by name
              else if (poiData.name && markerObj.name && markerObj.name === poiData.name) {
                isMatch = true;
              }
              // Priority 3: Match by coordinates (within 1 meter to avoid false matches)
              else if (coordinates) {
                const [markerLng, markerLat] = markerObj.coordinates;
                const distance = Math.sqrt(
                  Math.pow(markerLng - lng, 2) +
                  Math.pow(markerLat - lat, 2)
                );
                // Tighter threshold (0.00001 ≈ 1 meter) to avoid matching nearby different POIs
                if (distance < 0.00001) {
                  isMatch = true;
                }
              }

              // If found matching base marker, hide it
              if (isMatch) {
                // Note: We deliberately do NOT transfer waypoint numbers here
                // Star markers for recommendations should always show 1,2,3... based on order
                // Old waypoint numbers from itineraries should not be reused

                markerObj.marker.getElement().style.display = 'none';
                this.hiddenBaseMarkers.push(markerObj);
                break outerLoop;
              }
            }
          }
        }

        // Get emoji icon and color based on data source
        // Priority: SearchBox (maki/poi_category) > Rurubu (sgenre/category) > default
        let icon, bgColor;
        if (poiData.maki || poiData.poi_category) {
          // SearchBox POI - use official Mapbox icons
          const searchBoxIcon = this.getSearchBoxIcon(poiData.maki, poiData.poi_category);
          icon = searchBoxIcon.emoji;
          bgColor = searchBoxIcon.color;
        } else if (poiData.sgenre) {
          // Rurubu POI - use sgenre for more specific icon
          const genreIcon = this.getGenreIcon(poiData.sgenre);
          icon = genreIcon.emoji;
          bgColor = genreIcon.color;
        } else if (poiData.category) {
          // Rurubu POI - fallback to category
          icon = this.getPOICategoryIcon(poiData.category);
          bgColor = this.getCategoryColor(poiData.category);
        } else {
          // Default
          icon = '📍';
          bgColor = '#FF5722';
        }

        // Get ranking
        const ranking = poiData.rank || poiData.Rank || '';

        // Create wrapper for Mapbox positioning
        const wrapper = document.createElement('div');
        wrapper.style.width = '0px';
        wrapper.style.height = '0px';
        wrapper.style.position = 'relative';
        wrapper.style.zIndex = '1000'; // Ensure star markers appear above regular POI markers

        // Create pill marker element (same style as regular POI markers)
        const markerEl = document.createElement('div');
        markerEl.className = 'poi-pill-marker star-pill-marker';

        // Position to center the pill on the POI location
        markerEl.style.position = 'absolute';
        markerEl.style.top = '-16px';

        // Determine what to display: "-" for alternatives, otherwise recommendation numbers
        let displayNumber;
        if (are_alternatives) {
          displayNumber = '-'; // Show dash for alternatives (not ranked)
        } else {
          // Always use recommendation number (1, 2, 3...) for starred POIs
          displayNumber = recommendationNumber.toString();
        }
        markerEl.style.left = '-55px'; // Wider for number/dash

        const numberEl = document.createElement('div');
        numberEl.className = 'poi-waypoint-number';
        numberEl.textContent = displayNumber;
        markerEl.appendChild(numberEl);

        // Add icon with colored background
        const iconEl = document.createElement('div');
        iconEl.className = 'poi-pill-icon';
        iconEl.style.cssText = `background: ${bgColor} !important;`;
        iconEl.textContent = icon;
        markerEl.appendChild(iconEl);

        // Add ranking + star container
        const rankingContainer = document.createElement('div');
        rankingContainer.style.display = 'flex';
        rankingContainer.style.alignItems = 'center';
        rankingContainer.style.gap = '2px';

        // Add ranking if available
        if (ranking) {
          const rankingEl = document.createElement('span');
          rankingEl.className = 'poi-pill-ranking';
          rankingEl.textContent = ranking.toString().toUpperCase();
          rankingContainer.appendChild(rankingEl);
        }

        // Add star emoji (after ranking)
        const starEl = document.createElement('span');
        starEl.textContent = '⭐';
        starEl.style.fontSize = '12px';
        rankingContainer.appendChild(starEl);

        markerEl.appendChild(rankingContainer);

        // Add marker element to wrapper
        wrapper.appendChild(markerEl);

        // Add click handler to show POI modal
        markerEl.addEventListener('click', () => {
          if (this.poiClickCallback && poiData) {
            this.poiClickCallback(poiData);
          }
        });

        // Create and add marker
        const marker = new mapboxgl.Marker({
          element: wrapper,
          anchor: 'center'
        })
          .setLngLat([lng, lat])
          .addTo(this.map);

        // Store marker with props for later use (e.g., waypoint numbers)
        marker._poiData = poiData;

        this.starMarkers.push(marker);
        } catch (error) {
          console.error(`[ERROR] Failed to create star marker ${index + 1}:`, error);
          console.error('[ERROR] POI data:', poi);
        }
      });

      // Fit map bounds to show all recommended POIs
      if (pois.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        pois.forEach(poi => {
          bounds.extend(poi.coordinates);
        });

        // Fit with padding
        this.map.fitBounds(bounds, {
          padding: { top: 100, bottom: 100, left: 100, right: 100 },
          maxZoom: 15, // Don't zoom in too close
          duration: 1000 // Smooth animation
        });
      }

      // Report results
      const successCount = this.starMarkers.length;
      const result = {
        success: successCount > 0,
        message: successCount > 0
          ? `Added ${successCount} star markers to highlight recommended places on the map`
          : 'No POIs were found in the database',
        highlighted_count: successCount,
        highlighted_pois: pois.map(p => p.name)
      };

      // If some POIs weren't found, add warning
      if (notFoundPOIs.length > 0) {
        result.warning = `${notFoundPOIs.length} POI(s) not found in database and were skipped`;
        result.not_found_pois = notFoundPOIs.map(p => `#${p.index}: ${p.name} (id: ${p.id || 'none'})`);
        result.message += `. WARNING: ${notFoundPOIs.length} POI(s) not in database - use ONLY POIs from search results!`;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }],
        isError: notFoundPOIs.length > 0 && successCount === 0 // Error only if ALL POIs failed
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  /**
   * Execute draw_itinerary_route tool
   */
  async executeDrawItineraryRoute(args) {
    const { waypoints, profile = 'walking', color } = args;

    if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'At least 2 waypoints required to draw a route'
          }, null, 2)
        }],
        isError: true
      };
    }

    try {
      // Convert waypoints to {lng, lat} format
      const coordinates = waypoints.map(([lng, lat]) => ({ lng, lat }));

      // Draw route (color will be determined by profile if not provided)
      const result = await this.drawRoute(coordinates, {
        color,
        profile,
        routeId: `itinerary-${Date.now()}`
      });

      // Determine what color was used (same logic as drawRoute)
      const colors = {
        driving: '#4264FB',
        'driving-traffic': '#FF6B6B',
        walking: '#9C27B0',
        cycling: '#95E77D'
      };
      const usedColor = color || colors[profile] || colors.walking;

      // Format distance and duration for display
      const distanceKm = (result.distance / 1000).toFixed(2);
      const durationMin = Math.round(result.duration / 60);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Drew ${profile} route through ${waypoints.length} waypoints with directional arrows`,
            route_id: result.routeId,
            distance_km: distanceKm,
            duration_minutes: durationMin,
            waypoint_count: waypoints.length,
            profile: profile,
            color: usedColor
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  /**
   * Execute add_visit_order_markers tool
   */
  async executeAddVisitOrderMarkers(args) {
    const { locations, color = '#9C27B0' } = args;

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'No locations provided for numbered markers'
          }, null, 2)
        }],
        isError: true
      };
    }

    try {
      // Convert locations to format expected by drawNumberedMarkers
      const formattedLocations = locations.map((loc, index) => ({
        lng: loc.coordinates[0],
        lat: loc.coordinates[1],
        name: loc.name,
        label: loc.label || (index + 1).toString()
      }));

      // Draw numbered markers
      this.drawNumberedMarkers(formattedLocations, { color });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Added ${locations.length} numbered markers showing visit order`,
            marker_count: locations.length,
            locations: locations.map((loc, i) => ({
              number: i + 1,
              name: loc.name
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  /**
   * Clear all star markers from the map
   */
  clearStarMarkers() {
    this.starMarkers.forEach(marker => marker.remove());
    this.starMarkers = [];

    // Restore hidden base markers
    if (this.hiddenBaseMarkers) {
      this.hiddenBaseMarkers.forEach(markerObj => {
        markerObj.marker.getElement().style.display = '';

        // Clean up any orphaned waypoint numbers from previous routes
        // These can interfere with new highlight_recommended_pois calls
        const markerEl = markerObj.markerEl || markerObj.marker.getElement();
        if (markerEl) {
          const orphanedNumberEl = markerEl.querySelector('.poi-waypoint-number');
          if (orphanedNumberEl) {
            // Check if this number is tracked by an active route
            let isTrackedByRoute = false;
            if (this.waypointNumbers) {
              for (const trackedNumbers of this.waypointNumbers.values()) {
                if (trackedNumbers.some(t => t.numberEl === orphanedNumberEl)) {
                  isTrackedByRoute = true;
                  break;
                }
              }
            }

            // If not tracked by any active route, it's orphaned - remove it
            if (!isTrackedByRoute) {
              orphanedNumberEl.remove();
              // Restore original marker width (remove number spacing)
              if (markerEl.style.left === '-55px') {
                markerEl.style.left = '-20px'; // Standard width without number
              }
            }
          }
        }
      });
      this.hiddenBaseMarkers = [];
    }
  }

  /**
   * Clear all waypoint numbers from base markers
   * Called before highlighting recommended POIs to ensure fresh numbering (1,2,3...)
   * This prevents old itinerary waypoint numbers from interfering with recommendation numbers
   */
  clearAllWaypointNumbers() {
    if (!this.layerMarkers) return;

    // Iterate through all base markers and remove any waypoint numbers
    for (const markers of this.layerMarkers.values()) {
      for (const markerObj of markers) {
        const markerEl = markerObj.markerEl || markerObj.marker.getElement();
        if (markerEl) {
          const numberEl = markerEl.querySelector('.poi-waypoint-number');
          if (numberEl) {
            numberEl.remove();
            // Restore original marker width (remove number spacing)
            if (markerEl.style.left === '-55px') {
              markerEl.style.left = '-20px'; // Standard width without number
            }
          }
        }
      }
    }

    // Also clear the tracking map
    if (this.waypointNumbers) {
      this.waypointNumbers.clear();
    }
  }

  /**
   * Execute get_directions tool - Get directions between waypoints
   */
  async executeGetDirections(args) {
    const { waypoints, profile, alternatives, steps, language } = args;

    const options = {
      profile: profile || 'driving',
      alternatives: alternatives || false,
      steps: steps !== undefined ? steps : true,
      language: language || 'en'
    };

    try {
      // @ts-ignore - getDirections is async and returns Promise, await is necessary
      const result = await getDirections(waypoints, this.config.MAPBOX_ACCESS_TOKEN, options);

      const route = result.routes[0];
      const layerName = `route-${Date.now()}`;

      // Add the route to the map
      await this.addRouteToMap(route.geometry, {
        profile: options.profile,
        layerName: layerName
      });

      // Add markers for start and end points
      const startPoint = waypoints[0];
      const endPoint = waypoints[waypoints.length - 1];

      // Start marker (green)
      const startMarkerEl = document.createElement('div');
      startMarkerEl.style.width = '32px';
      startMarkerEl.style.height = '32px';
      startMarkerEl.style.borderRadius = '50%';
      startMarkerEl.style.backgroundColor = '#4CAF50';
      startMarkerEl.style.border = '3px solid white';
      startMarkerEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
      startMarkerEl.style.display = 'flex';
      startMarkerEl.style.alignItems = 'center';
      startMarkerEl.style.justifyContent = 'center';
      startMarkerEl.style.fontSize = '16px';
      startMarkerEl.style.fontWeight = 'bold';
      startMarkerEl.style.color = 'white';
      startMarkerEl.textContent = 'S';

      const startMarker = new mapboxgl.Marker({ element: startMarkerEl })
        .setLngLat(startPoint)
        .addTo(this.map);

      // End marker (red)
      const endMarkerEl = document.createElement('div');
      endMarkerEl.style.width = '32px';
      endMarkerEl.style.height = '32px';
      endMarkerEl.style.borderRadius = '50%';
      endMarkerEl.style.backgroundColor = '#F44336';
      endMarkerEl.style.border = '3px solid white';
      endMarkerEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
      endMarkerEl.style.display = 'flex';
      endMarkerEl.style.alignItems = 'center';
      endMarkerEl.style.justifyContent = 'center';
      endMarkerEl.style.fontSize = '16px';
      endMarkerEl.style.fontWeight = 'bold';
      endMarkerEl.style.color = 'white';
      endMarkerEl.textContent = 'E';

      const endMarker = new mapboxgl.Marker({ element: endMarkerEl })
        .setLngLat(endPoint)
        .addTo(this.map);

      // Store route data for hiding/showing later
      this.routes.push({
        layerName: layerName,
        startMarker: startMarker,
        endMarker: endMarker,
        visible: true,
        distance_km: (route.distance / 1000).toFixed(2),
        duration_minutes: Math.round(route.duration / 60)
      });


      // Return summary only (geometry is already on the map, no need to store it)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            distance_km: (route.distance / 1000).toFixed(2),
            duration_minutes: Math.round(route.duration / 60),
            route_profile: options.profile,
            waypoints: {
              start: startPoint,
              end: endPoint
            },
            message: 'Route displayed on map with start (S) and end (E) markers. Blue route line shows the driving path.'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: `Failed to get directions: ${error.message}`
          }, null, 2)
        }]
      };
    }
  }

  /**
   * Execute get_isochrone tool - Get reachable areas from a location
   */
  async executeGetIsochrone(args) {
    const { coordinates, contours_minutes, profile, colors } = args;

    const options = {
      profile: profile || 'driving',
      contours_minutes: contours_minutes,
      colors: colors
    };

    try {
      // @ts-ignore - getIsochrone is async and returns Promise, await is necessary
      const result = await getIsochrone(coordinates, this.config.MAPBOX_ACCESS_TOKEN, options);

      // Add isochrone polygons to map
      const layerName = `isochrone-${Date.now()}`;
      const layers = await this.addIsochroneToMap(result, layerName);

      // Store isochrone data for management
      this.isochrones.push({
        baseName: layerName,
        fillLayer: layers.fillLayer,
        outlineLayer: layers.outlineLayer,
        source: layerName,
        center: coordinates,
        profile: options.profile,
        contours: contours_minutes,
        visible: true
      });


      // Return summary (don't include full geometry to save tokens)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            center: coordinates,
            profile: options.profile,
            contours: result.features.map(f => ({
              minutes: f.properties.contour,
              color: f.properties.color
            })),
            message: `Isochrone polygons displayed on map showing reachable areas within ${contours_minutes.join(', ')} minutes by ${options.profile}.`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: `Failed to get isochrone: ${error.message}`
          }, null, 2)
        }]
      };
    }
  }

  /**
   * Execute get_travel_time_matrix tool
   */
  async executeGetTravelTimeMatrix(args) {
    const { coordinates, profile, sources, destinations, annotations } = args;

    // Convert profile to the format required by Matrix API (with "mapbox/" prefix)
    const profileWithPrefix = profile ? `mapbox/${profile}` : 'mapbox/driving';

    const options = {
      profile: profileWithPrefix
    };

    // Add optional parameters if provided
    if (sources !== undefined) {
      options.sources = sources;
    }
    if (destinations !== undefined) {
      options.destinations = destinations;
    }
    if (annotations !== undefined) {
      options.annotations = annotations;
    }

    try {
      const result = await getTravelTimeMatrix(coordinates, this.config.MAPBOX_ACCESS_TOKEN, options);

      // Format the result to be more readable for Claude
      const formattedResult = {
        success: true,
        profile: profile || 'driving',  // Use the original profile name without prefix
        coordinates: coordinates,
        durations: result.durations,  // 2D array: durations[source][destination] in seconds
        distances: result.distances,  // 2D array: distances[source][destination] in meters
        sources: result.sources || coordinates.map((coord, i) => ({ location: coord, location_index: i })),
        destinations: result.destinations || coordinates.map((coord, i) => ({ location: coord, location_index: i })),
        message: `Travel time matrix calculated for ${coordinates.length} locations using ${profile || 'driving'} profile. Matrix shows travel times (seconds) and distances (meters) between all origin-destination pairs.`
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(formattedResult, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: `Failed to calculate travel time matrix: ${error.message}`
          }, null, 2)
        }]
      };
    }
  }

  /**
   * Execute search_location tool - Search for locations using SearchBox API
   * Automatically displays results on the map (like Rurubu POIs)
   */
  async executeSearchLocation(args) {
    const { query, limit } = args;

    // Ensure limit is between 1 and 10 (SearchBox API requirement)
    let validLimit = 5; // default
    if (limit !== undefined && limit !== null) {
      validLimit = Math.max(1, Math.min(10, parseInt(limit)));
    }

    const options = {
      limit: validLimit,
      language: 'ja',  // Always use Japanese for better results in Japan
      types: 'poi',    // Only POIs
      country: 'JP'    // Limit to Japan
    };

    // Add proximity to user's current location if available
    if (this.userLocationMarker) {
      const userLngLat = this.userLocationMarker.getLngLat();
      options.proximity = [userLngLat.lng, userLngLat.lat];
    }

    try {
      // @ts-ignore - searchLocation is async and returns Promise, await is necessary
      const result = await searchLocation(query, this.config.MAPBOX_ACCESS_TOKEN, options);

      // Automatically display SearchBox POIs on the map (like Rurubu does)
      if (result.success && result.results && result.results.length > 0) {
        // Transform SearchBox results to GeoJSON format (same as Rurubu)
        const geojson = {
          type: 'FeatureCollection',
          features: result.results.map(poi => ({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: poi.coordinates  // [lng, lat]
            },
            properties: {
              id: poi.mapbox_id,
              name: poi.name,
              title: poi.name,
              address: poi.place_formatted || poi.full_address || '',
              rank: '-',  // SearchBox POIs don't have ratings
              poi_category: poi.poi_category,
              maki: poi.maki,
              mapbox_id: poi.mapbox_id,
              source: 'searchbox',  // Mark as SearchBox POI (infrastructure, not starred)
              // Store additional SearchBox metadata
              feature_type: poi.feature_type,
              context: poi.context,
              full_address: poi.full_address
            }
          }))
        };

        // Determine category from query or first result's poi_category
        let category = 'other';
        if (result.results[0]?.poi_category && result.results[0].poi_category.length > 0) {
          const primaryCategory = result.results[0].poi_category[0].toLowerCase();
          // Map to standard categories
          if (primaryCategory.includes('restaurant') || primaryCategory.includes('food')) category = 'eat';
          else if (primaryCategory.includes('cafe') || primaryCategory.includes('coffee')) category = 'cafe';
          else if (primaryCategory.includes('shop') || primaryCategory.includes('store')) category = 'buy';
          else if (primaryCategory.includes('hospital') || primaryCategory.includes('medical') ||
                   primaryCategory.includes('health') || primaryCategory.includes('clinic')) category = 'hospital';
          else if (primaryCategory.includes('hotel') || primaryCategory.includes('lodging')) category = 'lodging';
          else if (primaryCategory.includes('station') || primaryCategory.includes('transport')) category = 'transport';
        }

        // Store in search history (if app reference is available)
        let searchId = null;
        if (this.app && this.app.storeSearchData) {
          const metadata = {
            category: category,
            location: query,  // Use the search query as location
            source: 'searchbox'  // Mark as SearchBox data
          };
          searchId = await this.app.storeSearchData(geojson, metadata);

          // DO NOT auto-display - let Claude review and decide
          // Claude will call get_poi_summary to review, then show_search_results or highlight_recommended_pois
        } else {
          // Fallback: display using executeAddPointsAsMarkers if app is not available
          const points = result.results.map(poi => ({
            longitude: poi.coordinates[0],
            latitude: poi.coordinates[1],
            title: poi.name,
            name: poi.name,
            address: poi.place_formatted || poi.full_address || '',
            rank: '-',
            poi_category: poi.poi_category,
            maki: poi.maki,
            mapbox_id: poi.mapbox_id
          }));
          await this.executeAddPointsAsMarkers({ points });
        }

        // Return summary with search_id (results NOT auto-displayed)
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              search_id: searchId,
              query: query,
              count: result.results.length,
              results: result.results,
              message: `Found ${result.results.length} locations. Use get_poi_summary() to review them, then call show_search_results("${searchId}") to display on map.`
            }, null, 2)
          }]
        };
      }

      // No results found
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            query: query,
            count: 0,
            message: 'No locations found matching your search.'
          }, null, 2)
        }]
      };

    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            query: query,
            message: `Failed to search location: ${error.message}`
          }, null, 2)
        }]
      };
    }
  }

  /**
   * Transform GeoJSON format to points array format
   * Handles both GeoJSON FeatureCollection and already-formatted points array
   * @param {object} args - Arguments that may contain GeoJSON or points array
   * @returns {object} - Transformed arguments with points array
   */
  transformGeoJSONToPoints(args) {
    // If args already has a 'points' array, return as-is
    if (args.points && Array.isArray(args.points)) {
      return args;
    }

    // If args is a GeoJSON FeatureCollection
    if (args.type === 'FeatureCollection' && args.features) {
      return {
        points: args.features.map(feature => ({
          longitude: feature.geometry.coordinates[0],
          latitude: feature.geometry.coordinates[1],
          title: feature.properties.name || feature.properties.title || 'POI',
          description: feature.properties.address || feature.properties.description || '',
          color: feature.properties.color || '#FF0000',
          // Preserve all properties for marker click handler
          ...feature.properties
        })),
        layerName: args.layerName || 'points-layer'
      };
    }

    // If args has a geojson property
    if (args.geojson && args.geojson.type === 'FeatureCollection') {
      return {
        points: args.geojson.features.map(feature => ({
          longitude: feature.geometry.coordinates[0],
          latitude: feature.geometry.coordinates[1],
          title: feature.properties.name || feature.properties.title || 'POI',
          description: feature.properties.address || feature.properties.description || '',
          color: feature.properties.color || '#FF0000',
          // Preserve all properties for marker click handler
          ...feature.properties
        })),
        layerName: args.layerName || 'points-layer'
      };
    }

    // If args has a features array directly
    if (args.features && Array.isArray(args.features)) {
      return {
        points: args.features.map(feature => ({
          longitude: feature.geometry.coordinates[0],
          latitude: feature.geometry.coordinates[1],
          title: feature.properties.name || feature.properties.title || 'POI',
          description: feature.properties.address || feature.properties.description || '',
          color: feature.properties.color || '#FF0000',
          // Preserve all properties for marker click handler
          ...feature.properties
        })),
        layerName: args.layerName || 'points-layer'
      };
    }

    // Return args as-is if we can't transform it
    return args;
  }

  /**
   * Clear all map layers and markers
   */
  clearMap() {
    if (this.mapTools) {
      this.mapTools.executeTool('clear_map_layers', {});
    }

    // Clear any custom markers
    this.markers.forEach(marker => marker.remove());
    this.markers = [];

    // Clear pill-style POI markers
    if (this.layerMarkers) {
      this.layerMarkers.forEach((markers, layerName) => {
        markers.forEach(markerObj => {
          if (markerObj.marker) {
            markerObj.marker.remove();
          } else {
            markerObj.remove();
          }
        });
      });
      this.layerMarkers.clear();
    }

    // Clear star markers
    this.clearStarMarkers();

    // Clear all routes
    this.clearAllRoutes();

    // Clear all isochrones
    this.clearAllIsochrones();
  }

  /**
   * Remove a specific layer from the map
   * @param {string} layerName - Name of the layer to remove (e.g., "search-layer-search_1")
   */
  removeLayer(layerName) {
    if (!this.map) {
      console.warn('Map not initialized');
      return;
    }

    try {
      // Remove DOM markers if they exist (for pill-style markers)
      if (this.layerMarkers && this.layerMarkers.has(layerName)) {
        this.layerMarkers.get(layerName).forEach(markerObj => {
          if (markerObj.marker) {
            markerObj.marker.remove();
          } else {
            markerObj.remove(); // Backward compatibility
          }
        });
        this.layerMarkers.delete(layerName);
      }

      // Also try to remove old-style symbol layers (for backward compatibility)
      const layerId = `${layerName}-layer`;
      const sourceId = `${layerName}-source`;

      if (this.map.getLayer(layerId)) {
        this.map.removeLayer(layerId);
      }

      if (this.map.getSource(sourceId)) {
        this.map.removeSource(sourceId);
      }
    } catch (error) {
      console.error(`Failed to remove layer ${layerName}:`, error);
      throw error;
    }
  }

  /**
   * Recenter map to user location or default location
   */
  recenterMap() {
    if (this.map) {
      // If geolocate control is available and has a last known position, trigger it
      if (this.geolocateControl) {
        // Trigger the geolocate control to center on user location
        this.geolocateControl.trigger();
      } else {
        // Fallback: recenter to default (Tokyo)
        this.map.flyTo({
          center: this.config.DEFAULT_MAP_CENTER,
          zoom: this.config.DEFAULT_MAP_ZOOM,
          duration: 2000
        });
      }
    }
  }

  /**
   * Recenter map to user location or default center
   * @param {Object} userLocation - User location object {latitude, longitude}
   */
  recenterToUser(userLocation) {
    if (!this.map) return;

    if (userLocation) {
      this.map.flyTo({
        center: [userLocation.longitude, userLocation.latitude],
        zoom: 12,
        duration: 2000
      });
    } else {
      this.map.flyTo({
        center: this.config.DEFAULT_MAP_CENTER,
        zoom: this.config.DEFAULT_MAP_ZOOM,
        duration: 2000
      });
    }
  }

  /**
   * Get current map view context for AI
   * @returns {Object} Map context with center, zoom, and bounds
   */
  getMapContext() {
    if (!this.map) return null;

    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    const bounds = this.map.getBounds();

    return {
      center: {
        longitude: center.lng,
        latitude: center.lat
      },
      zoom: zoom,
      bounds: {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      }
    };
  }

  /**
   * Fit map to bounds
   * @param {array} bounds - [[west, south], [east, north]]
   */
  fitBounds(bounds) {
    if (this.map) {
      this.map.fitBounds(bounds, {
        padding: 50,
        duration: 1000
      });
    }
  }

  /**
   * Add a route line to the map from Directions API geometry
   * @param {object} geometry - GeoJSON LineString geometry from Directions API
   * @param {object} options - Layer options (profile, layerName)
   */
  async addRouteToMap(geometry, options = {}) {
    if (!this.map || !geometry) {
      throw new Error('Map not initialized or no geometry provided');
    }

    const layerName = options.layerName || `route-${Date.now()}`;
    const profile = options.profile || 'driving';

    // Color based on profile
    const colors = {
      driving: '#4264FB',
      'driving-traffic': '#FF6B6B',
      walking: '#9C27B0',
      cycling: '#95E77D'
    };
    const lineColor = colors[profile] || colors.driving;

    try {
      // Add source
      if (!this.map.getSource(layerName)) {
        this.map.addSource(layerName, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: geometry
          }
        });
      }

      // Add line layer
      if (!this.map.getLayer(layerName)) {
        this.map.addLayer({
          id: layerName,
          type: 'line',
          source: layerName,
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': lineColor,
            'line-width': 6,
            'line-opacity': 0.75
          }
        });
      }

      // Add arrow symbols layer to show direction
      const arrowLayerId = `${layerName}-arrows`;
      if (!this.map.getLayer(arrowLayerId)) {
        this.map.addLayer({
          id: arrowLayerId,
          type: 'symbol',
          source: layerName,
          layout: {
            'symbol-placement': 'line',
            'text-field': '>',
            'text-size': 24,
            'text-rotation-alignment': 'map',
            'text-keep-upright': false,
            'symbol-spacing': 100
          },
          paint: {
            'text-color': lineColor,
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 2
          }
        });
      }

      // Fit map to route bounds
      const coordinates = geometry.coordinates;
      if (coordinates && coordinates.length > 0) {
        const bounds = coordinates.reduce((bounds, coord) => {
          return bounds.extend(coord);
        }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));

        this.map.fitBounds(bounds, {
          padding: 50,
          duration: 1000
        });
      }

    } catch (error) {
      console.error(`[Map] Error adding route:`, error);
      throw error;
    }
  }

  /**
   * Add isochrone polygons to map
   * @param {object} geojson - GeoJSON FeatureCollection from Isochrone API
   * @param {string} layerName - Name for the layer
   */
  async addIsochroneToMap(geojson, layerName) {
    if (!this.map || !geojson) {
      throw new Error('Map not initialized or no GeoJSON provided');
    }

    try {
      // Add source
      if (!this.map.getSource(layerName)) {
        this.map.addSource(layerName, {
          type: 'geojson',
          data: geojson
        });
      }

      // Add fill layer for polygons
      const fillLayerName = `${layerName}-fill`;
      if (!this.map.getLayer(fillLayerName)) {
        this.map.addLayer({
          id: fillLayerName,
          type: 'fill',
          source: layerName,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'fill-opacity']
          }
        });
      }

      // Add outline layer
      const outlineLayerName = `${layerName}-outline`;
      if (!this.map.getLayer(outlineLayerName)) {
        this.map.addLayer({
          id: outlineLayerName,
          type: 'line',
          source: layerName,
          paint: {
            'line-color': ['get', 'color'],
            'line-opacity': ['get', 'opacity'],
            'line-width': 2
          }
        });
      }

      // Fit map to isochrone bounds
      const bounds = this.calculateGeojsonBounds(geojson);
      if (bounds) {
        this.map.fitBounds(bounds, {
          padding: 50,
          duration: 1000
        });
      }


      return {
        fillLayer: fillLayerName,
        outlineLayer: outlineLayerName
      };
    } catch (error) {
      console.error(`[Map] Error adding isochrone:`, error);
      throw error;
    }
  }

  /**
   * Calculate bounds from GeoJSON features
   * @param {object} geojson - GeoJSON FeatureCollection
   * @returns {array} bounds - [[west, south], [east, north]] or null if no features
   */
  calculateGeojsonBounds(geojson) {
    if (!geojson || !geojson.features || geojson.features.length === 0) {
      return null;
    }

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    const processCoordinate = (coord) => {
      const [lng, lat] = coord;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    };

    geojson.features.forEach(feature => {
      if (!feature.geometry) return;

      const { type, coordinates } = feature.geometry;

      if (type === 'Point') {
        processCoordinate(coordinates);
      } else if (type === 'LineString') {
        coordinates.forEach(coord => processCoordinate(coord));
      } else if (type === 'Polygon') {
        // Polygon coordinates: [outer ring, ...holes]
        coordinates[0].forEach(coord => processCoordinate(coord));
      } else if (type === 'MultiPolygon') {
        // MultiPolygon coordinates: [[[outer ring], ...], ...]
        coordinates.forEach(polygon => {
          polygon[0].forEach(coord => processCoordinate(coord));
        });
      }
    });

    // Check if we found any valid coordinates
    if (minLng === Infinity || minLat === Infinity) {
      return null;
    }

    // Return bounds in Mapbox GL JS format: [[west, south], [east, north]]
    return [[minLng, minLat], [maxLng, maxLat]];
  }

  /**
   * Add a custom marker to the map
   * @param {object} options - Marker options {lng, lat, popup}
   */
  addMarker({ lng, lat, popup }) {
    if (!this.map) return;

    const marker = new mapboxgl.Marker()
      .setLngLat([lng, lat]);

    if (popup) {
      marker.setPopup(new mapboxgl.Popup().setHTML(popup));
    }

    marker.addTo(this.map);
    this.markers.push(marker);

    return marker;
  }

  /**
   * Get current map center
   */
  getCenter() {
    if (this.map) {
      const center = this.map.getCenter();
      return [center.lng, center.lat];
    }
    return null;
  }

  /**
   * Get current map zoom
   */
  getZoom() {
    return this.map ? this.map.getZoom() : null;
  }

  /**
   * Get current map bounds
   */
  getBounds() {
    if (this.map) {
      const bounds = this.map.getBounds();
      return {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      };
    }
    return null;
  }

  /**
   * Update map coordinates display
   * @param {function} callback - Callback to receive coordinates
   */
  onMouseMove(callback) {
    if (this.map) {
      this.map.on('mousemove', (e) => {
        callback(e.lngLat);
      });
    }
  }

  /**
   * Get map instance
   */
  getMap() {
    return this.map;
  }

  /**
   * Setup click handler for POI markers
   * @param {function} callback - Callback to handle POI click with properties
   */
  onMarkerClick(callback) {
    if (!this.map) return;

    // Store callback for DOM markers to use
    this.poiClickCallback = callback;

    // Create click handler
    const clickHandler = (e) => {
      try {
        // Query for features at the click point
        // The mapbox-map-tools library creates circle layers with dynamic names
        // So we query all layers and filter for those with POI data
        const features = this.map.queryRenderedFeatures(e.point);

        // Filter for features that have POI properties
        // Map tools library uses 'title' and 'description', Rurubu uses 'name' and other fields
        const poiFeatures = features.filter(f =>
          f.properties &&
          (f.properties.title || f.properties.name) &&
          // Exclude base map features by checking for POI-specific properties
          (f.properties.description || f.properties.address || f.properties.phone || f.properties.category)
        );

        if (poiFeatures.length > 0) {
          const feature = poiFeatures[0];

          // Prevent default popup behavior
          e.preventDefault();

          // Pass both properties and coordinates for data lookup
          callback({
            ...feature.properties,
            _coordinates: feature.geometry.coordinates // Add coordinates for looking up full data
          });

          return false;
        }
      } catch (error) {
        // Silently handle queryRenderedFeatures errors (Mapbox internal issues)
      }
    };

    // Add tracked click listener
    this.addMapListener('click', clickHandler);

    // Change cursor on hover over POI features
    const mouseMoveHandler = (e) => {
      try {
        const features = this.map.queryRenderedFeatures(e.point);
        const poiFeatures = features.filter(f =>
          f.properties &&
          (f.properties.title || f.properties.name) &&
          (f.properties.description || f.properties.address || f.properties.phone || f.properties.category)
        );

        if (poiFeatures.length > 0) {
          this.map.getCanvas().style.cursor = 'pointer';
        } else {
          this.map.getCanvas().style.cursor = '';
        }
      } catch (error) {
        // Silently handle queryRenderedFeatures errors (Mapbox internal issues)
        // Reset cursor to default on error
        this.map.getCanvas().style.cursor = '';
      }
    };

    // Add tracked mousemove listener
    this.addMapListener('mousemove', mouseMoveHandler);
  }

  /**
   * Load a single icon image into the map
   */
  loadSingleIcon(iconName, emoji, color) {
    if (!this.map || this.map.hasImage(iconName)) return;

    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Draw colored circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();

    // White border
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Emoji
    ctx.font = Math.floor(size * 0.5) + 'px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2);

    const imageData = ctx.getImageData(0, 0, size, size);
    this.map.addImage(iconName, { width: size, height: size, data: imageData.data });
  }

  /**
   * Load icon images into the map for use in symbol layers
   */
  async loadIconImages() {
    if (!this.map || this.iconsLoaded) return;

    // Load fallback category icons for backward compatibility
    const icons = {
      'eat-icon': { emoji: '🍜', color: '#FF5252' },
      'see-icon': { emoji: '⛩️', color: '#9C27B0' },
      'shop-icon': { emoji: '🏪', color: '#2196F3' },
      'stay-icon': { emoji: '🏨', color: '#4CAF50' },
      'play-icon': { emoji: '🎭', color: '#FF9800' },
      'default-icon': { emoji: '📍', color: '#607D8B' }
    };

    for (const [iconName, config] of Object.entries(icons)) {
      this.loadSingleIcon(iconName, config.emoji, config.color);
    }

    this.iconsLoaded = true;
  }

  /**
   * Get icon emoji and color for SGenre code
   */
  getGenreIcon(sgenreCode) {
    // Genre code to icon mapping
    const genreIconMap = {
      // Nature (101-129)
      '101': { emoji: '🏞️', color: '#4CAF50' }, // Lakes
      '102': { emoji: '🏖️', color: '#00BCD4' }, // Coast
      '103': { emoji: '💧', color: '#2196F3' }, // Rivers/Waterfalls
      '104': { emoji: '⛰️', color: '#795548' }, // Mountains
      '105': { emoji: '🕳️', color: '#9E9E9E' }, // Caves
      '106': { emoji: '🪨', color: '#9E9E9E' }, // Rocks
      '107': { emoji: '🏝️', color: '#00BCD4' }, // Islands
      '108': { emoji: '🌲', color: '#4CAF50' }, // Forests
      '121': { emoji: '🦌', color: '#8BC34A' }, // Wildlife
      '122': { emoji: '🌸', color: '#E91E63' }, // Cherry blossoms
      '123': { emoji: '🍁', color: '#FF5722' }, // Autumn leaves
      '129': { emoji: '🌄', color: '#FF9800' }, // Other nature

      // Historical/Cultural (131-159)
      '131': { emoji: '⛩️', color: '#9C27B0' }, // Temples/Shrines
      '132': { emoji: '🏛️', color: '#673AB7' }, // Historical buildings
      '133': { emoji: '🗿', color: '#9E9E9E' }, // Monuments
      '134': { emoji: '🏰', color: '#5E35B1' }, // Castles/Ruins
      '135': { emoji: '🗼', color: '#FF9800' }, // Towers
      '136': { emoji: '🚶', color: '#607D8B' }, // Streets/Walking paths
      '137': { emoji: '⚰️', color: '#757575' }, // Cemeteries
      '139': { emoji: '🏢', color: '#607D8B' }, // Other buildings
      '141': { emoji: '🏞️', color: '#4CAF50' }, // Parks
      '142': { emoji: '🌿', color: '#8BC34A' }, // Gardens
      '144': { emoji: '🦁', color: '#FF9800' }, // Zoos
      '145': { emoji: '🐠', color: '#00BCD4' }, // Aquariums
      '146': { emoji: '🦒', color: '#8BC34A' }, // Animal/Plant parks
      '151': { emoji: '🏛️', color: '#3F51B5' }, // Museums
      '152': { emoji: '🎨', color: '#E91E63' }, // Art galleries
      '153': { emoji: '📚', color: '#607D8B' }, // Libraries
      '154': { emoji: '🏛️', color: '#5E35B1' }, // Memorial halls
      '159': { emoji: '🎭', color: '#9C27B0' }, // Other culture

      // Entertainment (161-199)
      '161': { emoji: '🏭', color: '#607D8B' }, // Factory tours
      '162': { emoji: '🏟️', color: '#FF5722' }, // Stadiums
      '163': { emoji: '🎭', color: '#9C27B0' }, // Theaters
      '169': { emoji: '🎪', color: '#FF9800' }, // Other entertainment
      '171': { emoji: '🛣️', color: '#9E9E9E' }, // Scenic roads
      '172': { emoji: '🌊', color: '#2196F3' }, // Dams
      '173': { emoji: '⚓', color: '#00BCD4' }, // Ports
      '174': { emoji: '🌉', color: '#FF9800' }, // Bridges
      '175': { emoji: '🗼', color: '#FF5722' }, // Lighthouses
      '176': { emoji: '✈️', color: '#2196F3' }, // Airports
      '177': { emoji: '🚉', color: '#607D8B' }, // Stations
      '178': { emoji: '🚙', color: '#4CAF50' }, // Road stations
      '179': { emoji: '🅿️', color: '#2196F3' }, // Service areas
      '180': { emoji: '🪑', color: '#9E9E9E' }, // Rest areas
      '181': { emoji: '🎨', color: '#FF9800' }, // Art installations
      '191': { emoji: '🎬', color: '#E91E63' }, // Film locations
      '197': { emoji: '🏛️', color: '#607D8B' }, // Public facilities
      '198': { emoji: 'ℹ️', color: '#2196F3' }, // Visitor centers
      '199': { emoji: '📍', color: '#FF9800' }, // Other spots

      // Activities (201-289)
      '201': { emoji: '🎢', color: '#FF5722' }, // Theme parks
      '202': { emoji: '🎨', color: '#E91E63' }, // Crafts
      '203': { emoji: '👨‍🍳', color: '#FF9800' }, // Cooking classes
      '204': { emoji: '🚜', color: '#8BC34A' }, // Farm activities
      '205': { emoji: '🐄', color: '#8BC34A' }, // Farm tours
      '206': { emoji: '💆', color: '#9C27B0' }, // Spa/Massage
      '209': { emoji: '✨', color: '#FF9800' }, // Other activities
      '211': { emoji: '🎾', color: '#8BC34A' }, // Tennis
      '212': { emoji: '⛳', color: '#4CAF50' }, // Golf
      '213': { emoji: '⚾', color: '#FF5722' }, // Baseball
      '214': { emoji: '⚽', color: '#4CAF50' }, // Soccer
      '215': { emoji: '🏇', color: '#795548' }, // Horse riding
      '221': { emoji: '🏖️', color: '#00BCD4' }, // Beaches
      '222': { emoji: '🏊', color: '#2196F3' }, // Pools
      '223': { emoji: '🎣', color: '#00BCD4' }, // Fishing
      '224': { emoji: '🛶', color: '#2196F3' }, // Canoeing
      '225': { emoji: '🤿', color: '#00BCD4' }, // Diving
      '226': { emoji: '🦪', color: '#FF9800' }, // Clam digging
      '229': { emoji: '🌊', color: '#00BCD4' }, // Other water sports
      '231': { emoji: '🪂', color: '#2196F3' }, // Sky sports
      '241': { emoji: '⛷️', color: '#00BCD4' }, // Skiing
      '242': { emoji: '⛸️', color: '#2196F3' }, // Skating
      '249': { emoji: '🏂', color: '#00BCD4' }, // Other winter sports
      '251': { emoji: '🏕️', color: '#8BC34A' }, // Camping
      '259': { emoji: '🏃', color: '#FF9800' }, // Other outdoor
      '261': { emoji: '🥾', color: '#795548' }, // Hiking
      '262': { emoji: '🚴', color: '#4CAF50' }, // Cycling
      '263': { emoji: '🐕', color: '#FF9800' }, // Dog parks
      '270': { emoji: '🎮', color: '#9C27B0' }, // Game centers
      '279': { emoji: '🎪', color: '#FF9800' }, // Other leisure
      '281': { emoji: '🚃', color: '#FF5722' }, // Tourist trains
      '282': { emoji: '⛴️', color: '#00BCD4' }, // Tourist boats
      '283': { emoji: '🚌', color: '#FF9800' }, // Tourist buses
      '284': { emoji: '🚡', color: '#FF5722' }, // Cable cars
      '289': { emoji: '🚠', color: '#FF9800' }, // Other transport

      // Food (300-390)
      '300': { emoji: '🍱', color: '#FF5252' }, // Japanese food
      '301': { emoji: '🍣', color: '#FF5252' }, // Sushi
      '302': { emoji: '🐟', color: '#00BCD4' }, // Seafood
      '303': { emoji: '🍗', color: '#FF9800' }, // Chicken
      '304': { emoji: '🥩', color: '#FF5722' }, // BBQ
      '305': { emoji: '🍲', color: '#FF5252' }, // Local cuisine
      '306': { emoji: '🍤', color: '#FF9800' }, // Tempura
      '307': { emoji: '🥓', color: '#FF9800' }, // Tonkatsu
      '308': { emoji: '🐍', color: '#795548' }, // Eel
      '311': { emoji: '🍽️', color: '#FF5252' }, // Western food
      '321': { emoji: '🥖', color: '#FF5252' }, // French
      '322': { emoji: '🍝', color: '#FF5252' }, // Italian
      '323': { emoji: '🥘', color: '#FF9800' }, // Spanish
      '324': { emoji: '🌶️', color: '#FF5252' }, // Thai
      '325': { emoji: '🥘', color: '#FF5722' }, // Korean
      '326': { emoji: '🍜', color: '#FF5252' }, // Other Asian
      '327': { emoji: '🍽️', color: '#FF5252' }, // Other European
      '330': { emoji: '🥟', color: '#FF5252' }, // Chinese
      '345': { emoji: '🍛', color: '#FF9800' }, // Curry
      '350': { emoji: '🌍', color: '#FF5252' }, // Other foreign
      '361': { emoji: '🍜', color: '#FF5252' }, // Ramen
      '362': { emoji: '🥟', color: '#FF9800' }, // Gyoza
      '363': { emoji: '🍜', color: '#FF9800' }, // Yakisoba
      '365': { emoji: '🍜', color: '#FF5252' }, // Other noodles
      '368': { emoji: '🍜', color: '#795548' }, // Soba/Udon
      '371': { emoji: '🥞', color: '#FF9800' }, // Okonomiyaki
      '372': { emoji: '🐙', color: '#FF5722' }, // Takoyaki
      '390': { emoji: '🍽️', color: '#FF5252' }, // Other dining
      '400': { emoji: '☕', color: '#795548' }, // Cafes
      '410': { emoji: '🍰', color: '#E91E63' }, // Cake
      '420': { emoji: '🍡', color: '#FF9800' }, // Sweets

      // Nightlife (501-599)
      '501': { emoji: '🍱', color: '#FF5252' }, // Kappo
      '502': { emoji: '🍶', color: '#FF5252' }, // Small restaurants
      '510': { emoji: '🍻', color: '#FF9800' }, // Izakaya
      '511': { emoji: '🍺', color: '#FF9800' }, // Beer/Wine
      '520': { emoji: '🍸', color: '#9C27B0' }, // Bars
      '530': { emoji: '🎵', color: '#E91E63' }, // Clubs
      '599': { emoji: '🍶', color: '#FF9800' }, // Other bars

      // Shopping (600-699)
      '600': { emoji: '🏬', color: '#2196F3' }, // Department stores
      '610': { emoji: '👔', color: '#E91E63' }, // Fashion
      '620': { emoji: '🎁', color: '#9C27B0' }, // Goods
      '630': { emoji: '🏺', color: '#FF9800' }, // Crafts
      '640': { emoji: '🍶', color: '#FF9800' }, // Food/Sake
      '650': { emoji: '🍰', color: '#E91E63' }, // Sweets
      '660': { emoji: '🥬', color: '#8BC34A' }, // Produce
      '699': { emoji: '🏪', color: '#2196F3' }, // Other shops

      // Onsen (701-799)
      '701': { emoji: '♨️', color: '#FF5722' }, // Hot springs
      '702': { emoji: '🛁', color: '#2196F3' }, // Baths
      '799': { emoji: '♨️', color: '#FF9800' }, // Other onsen

      // Other
      '999': { emoji: '📍', color: '#607D8B' }  // Other
    };

    const genreInfo = genreIconMap[sgenreCode] || { emoji: '📍', color: '#607D8B' };
    return {
      iconName: `genre-${sgenreCode}-icon`,
      ...genreInfo
    };
  }

  /**
   * Get icon name for category (fallback for backward compatibility)
   */
  getCategoryIcon(category) {
    const iconMap = {
      eat: 'eat-icon',
      see: 'see-icon',
      shop: 'shop-icon',
      stay: 'stay-icon',
      play: 'play-icon'
    };
    return iconMap[category] || 'default-icon';
  }

  /**
   * Get color for category (fallback for backward compatibility)
   */
  getCategoryColor(category) {
    const colorMap = {
      eat: '#FF5252',
      see: '#9C27B0',
      shop: '#2196F3',
      stay: '#4CAF50',
      play: '#FF9800'
    };
    return colorMap[category] || '#607D8B';
  }

  /**
   * Add icon layer to map from GeoJSON using custom pill-style DOM markers
   * REVERT NOTE: To revert to symbol layers, restore the original code that uses
   * this.map.addLayer with type: 'symbol'
   */
  async addIconLayer(geojson, layerName = 'icon-layer') {
    if (!this.map || !geojson) {
      console.warn('Cannot add icon layer: map or geojson invalid');
      return;
    }

    // Store markers by layer name for cleanup
    if (!this.layerMarkers) {
      this.layerMarkers = new Map();
    }

    // Remove existing markers for this layer
    if (this.layerMarkers.has(layerName)) {
      this.layerMarkers.get(layerName).forEach(marker => marker.remove());
      this.layerMarkers.delete(layerName);
    }

    const markers = [];

    // Create pill-style DOM marker for each feature
    geojson.features.forEach(feature => {
      const { coordinates } = feature.geometry;
      const props = feature.properties;
      const [lng, lat] = coordinates;

      // Get emoji icon and color based on data source
      let icon, bgColor;

      // Priority 1: SearchBox POIs (have source='searchbox')
      if (props.source === 'searchbox') {
        const searchBoxIcon = this.getSearchBoxIcon(props.maki, props.poi_category);
        icon = searchBoxIcon.emoji;
        bgColor = '#9E9E9E';  // Gray background for infrastructure POIs
      }
      // Priority 2: Rurubu POIs with specific genre
      else if (props.sgenre) {
        const genreIcon = this.getGenreIcon(props.sgenre);
        icon = genreIcon.emoji;
        bgColor = genreIcon.color;
      }
      // Priority 3: Rurubu POIs with category only
      else {
        icon = this.getPOICategoryIcon(props.category);
        bgColor = this.getCategoryColor(props.category);
      }

      // Format ranking (A-D or empty)
      const ranking = props.rank || props.Rank || '';
      const rankClass = ranking ? `rank-${ranking.toString().toLowerCase()}` : '';

      // Create wrapper for Mapbox positioning (0x0 div)
      const wrapper = document.createElement('div');
      wrapper.style.width = '0px';
      wrapper.style.height = '0px';
      wrapper.style.position = 'relative';
      wrapper.style.zIndex = '100'; // Lower than star markers (1000) to ensure stars appear on top

      // Create pill marker element
      const markerEl = document.createElement('div');
      markerEl.className = 'poi-pill-marker';

      // Set gray background for SearchBox POIs (entire pill, not just icon)
      if (props.source === 'searchbox') {
        markerEl.style.cssText += 'background: #E0E0E0 !important;';
      }

      // Position to center the pill on the POI location
      markerEl.style.position = 'absolute';
      markerEl.style.left = '-35px'; // Adjusted for larger size
      markerEl.style.top = '-16px';  // Adjusted for larger size

      // Add icon with colored background
      const iconEl = document.createElement('div');
      iconEl.className = 'poi-pill-icon';
      iconEl.style.cssText = `background: ${bgColor} !important;`;
      iconEl.textContent = icon;
      markerEl.appendChild(iconEl);

      // Add ranking if available
      if (ranking) {
        const rankingEl = document.createElement('div');
        rankingEl.className = `poi-pill-ranking ${rankClass}`;
        rankingEl.textContent = ranking.toString().toUpperCase();
        markerEl.appendChild(rankingEl);
      }

      // Add marker element to wrapper
      wrapper.appendChild(markerEl);

      // Create Mapbox GL JS marker with custom element (no popup, using modal instead)
      const marker = new mapboxgl.Marker({
        element: wrapper,
        anchor: 'center'
      })
        .setLngLat([lng, lat]);

      // Add click handler to show POI modal
      markerEl.addEventListener('click', () => {
        if (this.poiClickCallback) {
          this.poiClickCallback(props);
        }
      });

      // Add to map
      marker.addTo(this.map);

      // Store marker with metadata for waypoint matching
      markers.push({
        marker: marker,
        markerEl: markerEl,
        coordinates: [lng, lat],
        name: props.name || props.Name || '',
        props: props  // Store full props for star marker transfer
      });
    });

    // Store markers for this layer
    this.layerMarkers.set(layerName, markers);
  }

  /**
   * Get user's current location using Geolocation API
   * @returns {Promise<{latitude: number, longitude: number}>}
   */
  async getUserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'));
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
          let errorMessage = 'Unable to get your location';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Location permission denied. Please allow location access in your browser settings.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location information is unavailable.';
              break;
            case error.TIMEOUT:
              errorMessage = 'Location request timed out.';
              break;
          }
          reject(new Error(errorMessage));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  /**
   * Show user's current location on the map using Mapbox GeolocateControl
   * @returns {Promise<{latitude: number, longitude: number}>}
   */
  async showUserLocation() {
    if (!this.map || !this.geolocateControl) {
      throw new Error('Map or GeolocateControl not initialized');
    }

    return new Promise((resolve, reject) => {
      // Set up one-time event listeners for geolocation
      const handleGeolocate = (e) => {
        resolve({
          latitude: e.coords.latitude,
          longitude: e.coords.longitude,
          accuracy: e.coords.accuracy
        });
        // Clean up listeners
        this.geolocateControl.off('geolocate', handleGeolocate);
        this.geolocateControl.off('error', handleError);
      };

      const handleError = (error) => {
        console.error('[Map] Geolocation error:', error);
        reject(new Error('Unable to get your location. Please check location permissions.'));
        // Clean up listeners
        this.geolocateControl.off('geolocate', handleGeolocate);
        this.geolocateControl.off('error', handleError);
      };

      // Attach event listeners
      this.geolocateControl.on('geolocate', handleGeolocate);
      this.geolocateControl.on('error', handleError);

      // Trigger the geolocation control
      // This will show the blue puck and optionally fly to user location
      this.geolocateControl.trigger();
    });
  }

  /**
   * Remove user location marker from the map
   */
  removeUserLocation() {
    if (this.userLocationMarker) {
      this.userLocationMarker.remove();
      this.userLocationMarker = null;
    }
  }

  /**
   * Check if user location is currently shown
   */
  isUserLocationShown() {
    return this.userLocationMarker !== null;
  }

  /**
   * Show a location marker at specific coordinates
   * @param {number} longitude - Longitude coordinate
   * @param {number} latitude - Latitude coordinate
   * @param {string} label - Label for the location
   * @param {boolean} flyTo - Whether to fly to the location
   */
  async showLocationMarker(longitude, latitude, label = 'Location', flyTo = false) {
    if (!this.map) {
      throw new Error('Map not initialized');
    }

    // Remove existing user location marker if any
    if (this.userLocationMarker) {
      this.userLocationMarker.remove();
    }

    // Create a custom marker element
    const markerEl = document.createElement('div');
    markerEl.className = 'user-location-marker';
    markerEl.style.width = '24px';
    markerEl.style.height = '24px';
    markerEl.style.borderRadius = '50%';
    markerEl.style.backgroundColor = '#4285F4';
    markerEl.style.border = '3px solid white';
    markerEl.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    markerEl.style.cursor = 'pointer';

    // Create the marker
    this.userLocationMarker = new mapboxgl.Marker({
      element: markerEl,
      anchor: 'center'
    })
      .setLngLat([longitude, latitude])
      .setPopup(
        new mapboxgl.Popup({ offset: 25 })
          .setHTML(`
            <div style="padding: 8px;">
              <strong>${label}</strong>
            </div>
          `)
      )
      .addTo(this.map);

    // Fly to the location if requested
    if (flyTo) {
      this.map.flyTo({
        center: [longitude, latitude],
        zoom: 14,
        duration: 2000
      });
    }

  }

  /**
   * Hide all routes from the map
   */
  hideAllRoutes() {
    this.routes.forEach(route => {
      // Handle waypoint numbers integrated into POI markers
      if (route.waypointNumberLayerId && this.waypointNumbers) {
        const numbersToHide = this.waypointNumbers.get(route.waypointNumberLayerId);
        if (numbersToHide) {
          numbersToHide.forEach(({ numberEl }) => {
            if (numberEl) {
              numberEl.style.display = 'none';
            }
          });
        }
      }

      if (route.visible) {
        // Hide the route layer
        if (this.map.getLayer(route.layerName)) {
          this.map.setLayoutProperty(route.layerName, 'visibility', 'none');
        }
        // Hide markers
        route.startMarker.remove();
        route.endMarker.remove();
        route.visible = false;
      }
    });
  }

  /**
   * Show all routes on the map
   */
  showAllRoutes() {
    this.routes.forEach(route => {
      // Handle waypoint numbers integrated into POI markers
      if (route.waypointNumberLayerId && this.waypointNumbers) {
        const numbersToShow = this.waypointNumbers.get(route.waypointNumberLayerId);
        if (numbersToShow) {
          numbersToShow.forEach(({ numberEl }) => {
            if (numberEl) {
              numberEl.style.display = 'flex';
            }
          });
        }
      }

      if (!route.visible) {
        // Show the route layer
        if (this.map.getLayer(route.layerName)) {
          this.map.setLayoutProperty(route.layerName, 'visibility', 'visible');
        }
        // Show markers
        route.startMarker.addTo(this.map);
        route.endMarker.addTo(this.map);
        route.visible = true;
      }
    });
  }

  /**
   * Clear all routes from the map and memory
   */
  clearAllRoutes() {
    this.routes.forEach(route => {
      // Handle waypoint numbers integrated into POI markers
      if (route.waypointNumberLayerId && this.waypointNumbers) {
        const numbersToRemove = this.waypointNumbers.get(route.waypointNumberLayerId);
        if (numbersToRemove) {
          numbersToRemove.forEach(({ markerEl, numberEl, originalLeft, originalNumber }) => {
            if (numberEl && numberEl.parentNode === markerEl) {
              if (originalNumber !== null) {
                // This was a starred POI - restore original recommendation number
                numberEl.textContent = originalNumber;
              } else {
                // This was a regular marker - remove the number element
                markerEl.removeChild(numberEl);
                // Restore original left position
                if (originalLeft !== undefined) {
                  markerEl.style.left = `${originalLeft}px`;
                }
              }
            }
          });
          this.waypointNumbers.delete(route.waypointNumberLayerId);
        }
      }
      // Handle new format (multi-waypoint routes with arrows)
      if (route.layers && Array.isArray(route.layers)) {
        route.layers.forEach(layerId => {
          if (this.map.getLayer(layerId)) {
            this.map.removeLayer(layerId);
          }
        });
        if (route.source && this.map.getSource(route.source)) {
          this.map.removeSource(route.source);
        }
      }
      // Handle old format (point-to-point directions)
      else if (route.layerName) {
        // Remove arrows layer first (if it exists)
        const arrowsLayerId = `${route.layerName}-arrows`;
        if (this.map.getLayer(arrowsLayerId)) {
          this.map.removeLayer(arrowsLayerId);
        }
        // Remove main layer
        if (this.map.getLayer(route.layerName)) {
          this.map.removeLayer(route.layerName);
        }
        // Remove source (after all layers are removed)
        if (this.map.getSource(route.layerName)) {
          this.map.removeSource(route.layerName);
        }
        // Remove markers
        if (route.startMarker) route.startMarker.remove();
        if (route.endMarker) route.endMarker.remove();
      }
    });
    this.routes = [];

    // Clear all waypoint numbers
    if (this.waypointNumbers) {
      this.waypointNumbers.clear();
    }
  }

  /**
   * Hide all isochrones on the map
   */
  hideAllIsochrones() {
    this.isochrones.forEach(iso => {
      if (iso.visible) {
        // Hide both fill and outline layers
        if (this.map.getLayer(iso.fillLayer)) {
          this.map.setLayoutProperty(iso.fillLayer, 'visibility', 'none');
        }
        if (this.map.getLayer(iso.outlineLayer)) {
          this.map.setLayoutProperty(iso.outlineLayer, 'visibility', 'none');
        }
        iso.visible = false;
      }
    });
  }

  /**
   * Show all isochrones on the map
   */
  showAllIsochrones() {
    this.isochrones.forEach(iso => {
      if (!iso.visible) {
        // Show both fill and outline layers
        if (this.map.getLayer(iso.fillLayer)) {
          this.map.setLayoutProperty(iso.fillLayer, 'visibility', 'visible');
        }
        if (this.map.getLayer(iso.outlineLayer)) {
          this.map.setLayoutProperty(iso.outlineLayer, 'visibility', 'visible');
        }
        iso.visible = true;
      }
    });
  }

  /**
   * Clear all isochrones from the map and memory
   */
  clearAllIsochrones() {
    this.isochrones.forEach(iso => {
      // Remove fill layer
      if (this.map.getLayer(iso.fillLayer)) {
        this.map.removeLayer(iso.fillLayer);
      }
      // Remove outline layer
      if (this.map.getLayer(iso.outlineLayer)) {
        this.map.removeLayer(iso.outlineLayer);
      }
      // Remove source
      if (this.map.getSource(iso.source)) {
        this.map.removeSource(iso.source);
      }
    });
    this.isochrones = [];
  }

  /**
   * Set map language for text labels
   * @param {string} language - Language code ('en' or 'ja')
   */
  setMapLanguage(language) {
    if (!this.map || !this.map.setLanguage) {
      console.warn('[Map] Language control not available');
      return;
    }

    this.map.setLanguage(language);
  }

  /**
   * Add tracked event listener to map
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  addMapListener(event, handler) {
    if (!this.map) return;
    this.map.on(event, handler);
    this.eventHandlers.push({ event, handler });
  }

  /**
   * Add tracked DOM event listener
   * @param {HTMLElement} element - DOM element
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  addDOMListener(element, event, handler) {
    if (!element) return;
    element.addEventListener(event, handler);
    this.domEventHandlers.push({ element, event, handler });
  }

  /**
   * Comprehensive cleanup method to prevent memory leaks
   * Call this when destroying the map or cleaning up the application
   */
  destroy() {
    try {
      // Remove all map event listeners
      if (this.map && this.eventHandlers.length > 0) {
        this.eventHandlers.forEach(({ event, handler }) => {
          try {
            this.map.off(event, handler);
          } catch (e) {
            console.warn(`[Map] Error removing event listener for ${event}:`, e);
          }
        });
        this.eventHandlers = [];
      }

      // Remove all DOM event listeners
      if (this.domEventHandlers.length > 0) {
        this.domEventHandlers.forEach(({ element, event, handler }) => {
          try {
            element.removeEventListener(event, handler);
          } catch (e) {
            console.warn('[Map] Error removing DOM event listener:', e);
          }
        });
        this.domEventHandlers = [];
      }

      // Clear all markers
      this.clearAllMarkers();
      this.clearStarMarkers();
      this.clearAllRoutes();
      this.clearAllIsochrones();

      // Remove user location marker
      if (this.userLocationMarker) {
        this.userLocationMarker.remove();
        this.userLocationMarker = null;
      }

      // Remove controls
      if (this.map) {
        if (this.languageControl) {
          try {
            this.map.removeControl(this.languageControl);
          } catch (e) {
            console.warn('[Map] Error removing language control:', e);
          }
          this.languageControl = null;
        }

        if (this.geolocateControl) {
          try {
            this.map.removeControl(this.geolocateControl);
          } catch (e) {
            console.warn('[Map] Error removing geolocate control:', e);
          }
          this.geolocateControl = null;
        }
      }

      // Remove map instance
      if (this.map) {
        try {
          this.map.remove();
        } catch (e) {
          console.warn('[Map] Error removing map:', e);
        }
        this.map = null;
      }

      // Clear references
      this.mapTools = null;
      this.app = null;
    } catch (error) {
      console.error('[Map] Error during cleanup:', error);
    }
  }

  /**
   * Clear all markers from the map
   */
  clearAllMarkers() {
    if (this.markers.length > 0) {
      this.markers.forEach(marker => {
        try {
          marker.remove();
        } catch (e) {
          console.warn('[Map] Error removing marker:', e);
        }
      });
      this.markers = [];
    }
  }

  /**
   * Draw a route on the map with directional arrows
   * @param {Array<{lng: number, lat: number}>} coordinates - Array of waypoints
   * @param {Object} options - Route options
   * @param {string} options.color - Route color (default: '#9C27B0')
   * @param {string} options.routeId - Optional custom route ID
   * @param {string} options.profile - Routing profile: 'driving', 'walking', 'cycling' (default: 'walking')
   * @returns {Promise<Object>} Route information
   */
  async drawRoute(coordinates, options = {}) {
    const {
      routeId = `route-${Date.now()}`,
      profile = 'walking'
    } = options;

    // Color based on profile (matching get_directions color scheme)
    const colors = {
      driving: '#4264FB',
      'driving-traffic': '#FF6B6B',
      walking: '#9C27B0',
      cycling: '#95E77D'
    };
    const color = options.color || colors[profile] || colors.walking;

    try {
      if (!coordinates || coordinates.length < 2) {
        throw new Error('At least 2 coordinates required for route');
      }

      // Format coordinates for Directions API
      const coordString = coordinates.map(c => `${c.lng},${c.lat}`).join(';');
      const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordString}?` +
        `geometries=geojson&overview=full&steps=false&language=ja&access_token=${mapboxgl.accessToken}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Directions API error: ${response.status}`);
      }

      const data = await response.json();
      if (!data.routes || data.routes.length === 0) {
        throw new Error('No route found');
      }

      const route = data.routes[0];
      const geometry = route.geometry;

      // Remove existing route layers if they exist
      if (this.map.getLayer(`${routeId}-line`)) {
        this.map.removeLayer(`${routeId}-line`);
      }
      if (this.map.getLayer(`${routeId}-arrows`)) {
        this.map.removeLayer(`${routeId}-arrows`);
      }
      if (this.map.getSource(routeId)) {
        this.map.removeSource(routeId);
      }

      // Add route source
      this.map.addSource(routeId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: geometry
        }
      });

      // Add route line layer
      this.map.addLayer({
        id: `${routeId}-line`,
        type: 'line',
        source: routeId,
        paint: {
          'line-color': color,
          'line-width': 5,
          'line-opacity': 0.8
        }
      });

      // Add arrow symbols layer
      this.map.addLayer({
        id: `${routeId}-arrows`,
        type: 'symbol',
        source: routeId,
        layout: {
          'symbol-placement': 'line',
          'text-field': '>',
          'text-size': 24,
          'text-rotation-alignment': 'map',
          'text-keep-upright': false,
          'symbol-spacing': 100
        },
        paint: {
          'text-color': color,
          'text-halo-color': '#FFFFFF',
          'text-halo-width': 2
        }
      });

      // Track route for cleanup
      this.routes.push({
        id: routeId,
        layers: [`${routeId}-line`, `${routeId}-arrows`],
        source: routeId
      });

      return {
        routeId,
        distance: route.distance,
        duration: route.duration,
        geometry
      };

    } catch (error) {
      console.error('[Map] Error drawing route:', error);
      throw error;
    }
  }

  /**
   * Add numbered markers to show visit order using symbol layer
   * @param {Array<{lng: number, lat: number, label: string, name: string}>} locations - Locations with numbers/labels
   * @param {Object} options - Marker options
   * @param {string} options.color - Marker text color (default: '#1976d2')
   * @param {string} options.layerId - Optional custom layer ID
   * @returns {Object} Layer information
   */
  drawNumberedMarkers(locations, options = {}) {
    const { layerId = `numbered-markers-${Date.now()}` } = options;

    try {
      // Initialize waypoint number tracking if not exists
      if (!this.waypointNumbers) {
        this.waypointNumbers = new Map();
      }

      // Remove existing waypoint numbers for this layer
      if (this.waypointNumbers.has(layerId)) {
        const existingNumbers = this.waypointNumbers.get(layerId);
        existingNumbers.forEach(({ markerEl, numberEl, originalLeft, originalNumber }) => {
          if (numberEl && numberEl.parentNode === markerEl) {
            if (originalNumber !== null) {
              // This was a starred POI - restore original recommendation number
              numberEl.textContent = originalNumber;
            } else {
              // This was a regular marker - remove the number element
              markerEl.removeChild(numberEl);
              // Restore original left position
              if (originalLeft !== undefined) {
                markerEl.style.left = `${originalLeft}px`;
              }
            }
          }
        });
        this.waypointNumbers.delete(layerId);
      }

      const modifiedMarkers = [];

      // Get star markers only - waypoint numbers are only for itineraries with starred POIs
      const allPOIMarkers = [];

      if (this.starMarkers && this.starMarkers.length > 0) {
        this.starMarkers.forEach(marker => {
          const lngLat = marker.getLngLat();
          const element = marker.getElement();
          const markerEl = element.querySelector('.star-pill-marker');
          if (markerEl) {
            allPOIMarkers.push({
              marker: marker,
              markerEl: markerEl,
              coordinates: [lngLat.lng, lngLat.lat],
              props: marker._poiData || {}
            });
          }
        });
      }

      // For each waypoint location, find the closest POI marker and add number
      locations.forEach((location, index) => {
        const targetLng = location.lng || location.coordinates?.[0];
        const targetLat = location.lat || location.coordinates?.[1];
        const label = location.label || (index + 1).toString();

        if (!targetLng || !targetLat) {
          return;
        }

        // Find closest POI marker
        let closestMarker = null;
        let minDistance = Infinity;

        allPOIMarkers.forEach(markerObj => {
          const [markerLng, markerLat] = markerObj.coordinates;
          const distance = Math.sqrt(
            Math.pow(markerLng - targetLng, 2) +
            Math.pow(markerLat - targetLat, 2)
          );

          if (distance < minDistance) {
            minDistance = distance;
            closestMarker = markerObj;
          }
        });

        // If found a close enough marker (within ~100m), add waypoint number
        if (closestMarker && minDistance < 0.001) {
          const markerEl = closestMarker.markerEl;

          // Check if a number already exists (from recommendation numbering)
          const existingNumberEl = markerEl.querySelector('.poi-waypoint-number');
          let originalNumber = null;

          if (existingNumberEl) {
            // Store original number text so we can restore it later
            originalNumber = existingNumberEl.textContent;
            // Update existing number with waypoint label instead of adding a new one
            existingNumberEl.textContent = label;
            // No need to adjust positioning - already sized for a number
          } else {
            // Create new waypoint number element
            const numberEl = document.createElement('div');
            numberEl.className = 'poi-waypoint-number';
            numberEl.textContent = label;

            // Insert at the beginning of the pill
            markerEl.insertBefore(numberEl, markerEl.firstChild);

            // Force layout recalculation by accessing offsetHeight
            void markerEl.offsetHeight;

            // Also adjust the left offset since the pill is now wider
            const currentLeft = parseInt(markerEl.style.left) || -35;
            markerEl.style.left = `${currentLeft - 15}px`; // Shift left by ~15px for the number
          }

          // Update the click handler to use waypoint data if available
          // Clone the event listeners by replacing the element
          const newMarkerEl = markerEl.cloneNode(true);
          markerEl.parentNode.replaceChild(newMarkerEl, markerEl);

          // Add new click handler with waypoint-specific data
          newMarkerEl.addEventListener('click', () => {
            if (this.poiClickCallback) {
              // Merge waypoint location data with original POI props
              const waypointProps = {
                ...closestMarker.props,
                ...(location.name && { name: location.name }),
                ...(location.address && { address: location.address }),
                ...(location.tel && { tel: location.tel }),
                ...(location.time && { time: location.time }),
                ...(location.price && { price: location.price }),
                ...(location.rank && { rank: location.rank }),
                ...(location.photo && { photo: location.photo }),
                ...(location.summary && { summary: location.summary })
              };
              this.poiClickCallback(waypointProps);
            }
          });

          modifiedMarkers.push({
            markerEl: newMarkerEl,
            numberEl: newMarkerEl.querySelector('.poi-waypoint-number'),
            originalLeft: existingNumberEl ? null : currentLeft, // Don't store originalLeft if we updated existing number
            originalNumber: originalNumber // Store original recommendation number to restore later
          });
        }
      });

      // Store modified markers for cleanup
      this.waypointNumbers.set(layerId, modifiedMarkers);

      // Track for cleanup
      this.routes.push({
        id: layerId,
        layers: [],
        source: null,
        type: 'numbered-markers',
        waypointNumberLayerId: layerId
      });

      return { layerId, featureCount: modifiedMarkers.length };

    } catch (error) {
      console.error('[Map] Error adding numbered markers:', error);
      throw error;
    }
  }

}