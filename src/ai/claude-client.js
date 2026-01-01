/**
 * Claude Client
 * Handles communication with Claude API and coordinates dual MCP architecture
 * - Rurubu MCP (client-side virtual server)
 * - Map Tools MCP (visualization library)
 */

import { errorLogger } from '../core/error-logger.js';

export class ClaudeClient {
  constructor(options) {
    // Support both object and legacy positional arguments for backward compatibility
    if (typeof options === 'string') {
      // Legacy: constructor(apiKey, rurubuMCP, mapController, i18n, config, app, onRurubuData)
      const [apiKey, rurubuMCP, mapController, i18n, config, app, onRurubuData] = arguments;
      options = {
        apiKey,
        dataSources: rurubuMCP ? [rurubuMCP] : [],
        mapController,
        i18n,
        config,
        app,
        onDataCallback: onRurubuData ? (source, toolName, result) => {
          if (toolName.includes('search') && toolName.includes('poi')) {
            onRurubuData(result);
          }
        } : null
      };
    }

    // Extract options with defaults
    const {
      apiKey,
      dataSources = [],           // Array of DataSourceBase instances
      mapController,
      i18n,
      config,
      app = null,
      systemPromptBuilder = null,  // Optional: custom system prompt function
      onDataCallback = null        // Generic callback: (dataSource, toolName, result) => void
    } = options;

    this.apiKey = apiKey;
    this.dataSources = Array.isArray(dataSources) ? dataSources : [dataSources].filter(Boolean);
    this.mapController = mapController;
    this.i18n = i18n;
    this.config = config;
    this.app = app;
    this.systemPromptBuilder = systemPromptBuilder;
    this.onDataCallback = onDataCallback;
    this.conversationHistory = [];

    // Token caching - separate Map to avoid polluting message objects sent to API
    this.messageTokenCache = new WeakMap(); // WeakMap allows garbage collection of old messages
    this._cachedSystemPromptTokens = undefined;
    this._lastSystemPrompt = undefined;

    // Context tracking
    this.userLocation = null; // User's current location
    this.mapView = null; // Current map view (center, zoom, bounds)

    this.systemPrompt = this.buildSystemPrompt();

    // Token management
    this.MAX_TOKENS = config.MAX_CONTEXT_TOKENS || 200000;
    this.PRUNE_THRESHOLD = config.PRUNE_THRESHOLD_TOKENS || 160000; // Start pruning at 80% capacity
    this.WARNING_THRESHOLD = config.WARNING_THRESHOLD_TOKENS || 140000; // Show warning at 70% capacity
    this.conversationSummary = null; // Store summary of pruned messages
  }

  /**
   * Build the system prompt for Claude
   */
  buildSystemPrompt(userLocation = null, mapView = null) {
    // If custom system prompt builder provided, use it
    if (this.systemPromptBuilder) {
      return this.systemPromptBuilder({
        userLocation: userLocation || this.userLocation,
        mapView: mapView || this.mapView,
        i18n: this.i18n,
        dataSources: this.dataSources,
        config: this.config
      });
    }

    // Otherwise, use default generic prompt
    return this.buildDefaultSystemPrompt(userLocation, mapView);
  }

  /**
   * Build default system prompt (generic, domain-agnostic)
   * This is used when no custom systemPromptBuilder is provided
   */
  buildDefaultSystemPrompt(userLocation = null, mapView = null) {
    // Get current language
    const currentLang = this.i18n.getCurrentLanguage();
    const langName = currentLang === 'ja' ? 'Japanese' : 'English';

    // Build location context
    let locationContext = '';
    if (userLocation) {
      const coords = `${userLocation.latitude.toFixed(6)}, ${userLocation.longitude.toFixed(6)}`;
      const placeName = userLocation.placeName || userLocation.name;
      if (placeName) {
        locationContext = `\n\nUSER LOCATION:\n- Current location: ${placeName}\n- Coordinates: ${coords}\n- When user asks "around me", "near me", "nearby", use this location as reference`;
      } else {
        locationContext = `\n\nUSER LOCATION:\n- Current location: ${coords}\n- When user asks "around me", "near me", "nearby", use this location as reference`;
      }
    }

    // Build map view context
    let mapViewContext = '';
    if (mapView) {
      const { center, zoom, placeName, name } = mapView;
      const coords = `${center.lat.toFixed(4)}°N, ${center.lng.toFixed(4)}°E`;
      if (placeName || name) {
        const location = placeName || name;
        mapViewContext = `Map view: ${location} (${coords}, zoom ${zoom.toFixed(1)})\n\n`;
      } else {
        mapViewContext = `Map view: ${coords} (zoom ${zoom.toFixed(1)})\n\n`;
      }
    }

    return `${mapViewContext}You are an AI assistant helping users explore locations and find places of interest.

YOUR APPROACH:
- Ask clarifying questions when needed
- Use available tools to search for relevant information
- Present findings clearly and accurately
- Respond in ${langName}${locationContext}

TOOLS AVAILABLE:
- Use search tools to find places and information
- Use map tools to visualize locations and routes
- Always verify data before presenting it to users

GUIDELINES:
- Ask for clarification if the user's request is vague
- Search for relevant information using the tools available
- Present only data-backed information
- Offer to adjust or provide more options based on user feedback`;
  }

  /**
   * Build Japan-specific system prompt (deprecated - kept for reference)
   * This was the original domain-specific prompt. New projects should create their own
   * system prompt builder and pass it via the systemPromptBuilder option.
   */
  buildJapanTravelPrompt(userLocation = null, mapView = null) {
    // Get current language
    const currentLang = this.i18n.getCurrentLanguage();
    const langName = currentLang === 'ja' ? 'Japanese' : 'English';

    // Build location context
    let locationContext = '';
    if (userLocation) {
      const coords = `${userLocation.latitude.toFixed(6)}, ${userLocation.longitude.toFixed(6)}`;
      const placeName = userLocation.placeName || userLocation.name;
      if (placeName) {
        locationContext = `\n\nUSER LOCATION:\n- Current location: ${placeName}\n- Coordinates: ${coords}\n- When user asks "around me", "near me", "nearby", use this location as reference`;
      } else {
        locationContext = `\n\nUSER LOCATION:\n- Current location: ${coords}\n- When user asks "around me", "near me", "nearby", use this location as reference`;
      }
    }

    // Build map view context
    let mapViewContext = '';
    if (mapView) {
      const { center, zoom, placeName, name } = mapView;
      const coords = `${center.lat.toFixed(4)}°N, ${center.lng.toFixed(4)}°E`;
      if (placeName || name) {
        const location = placeName || name;
        mapViewContext = `Map view: ${location} (${coords}, zoom ${zoom.toFixed(1)})\n\n`;
      } else {
        mapViewContext = `Map view: ${coords} (zoom ${zoom.toFixed(1)})\n\n`;
      }
    }

    return `${mapViewContext}You are Kenji, a seasoned Japan travel expert with 15 years of experience living and exploring Japan. You run a boutique travel consulting service helping travelers discover authentic Japanese experiences beyond the tourist trail.

YOUR PHILOSOPHY:
- Every traveler is unique - no two itineraries should be the same
- Understanding precedes searching - never recommend blindly
- Quality over quantity - 3 perfect spots beat 20 mediocre ones
- Narrative matters - places should tell a cohesive story
- Local knowledge wins - ratings don't capture soul

YOUR CONVERSATIONAL STYLE:
- Warm, enthusiastic, but never pushy
- Think out loud to build trust: "For art lovers, I'm thinking..."
- Ask clarifying questions naturally when needed
- Explain your reasoning: "I picked this because..."
- Respond in ${langName} but preserve Japanese POI details exactly${locationContext}

MANDATORY 5-PHASE ANTI-HALLUCINATION WORKFLOW:

**PHASE 1: GENRE DISCOVERY (Required for vague queries)**

**🔍 QUERY CLASSIFICATION - Determine Workflow Type:**

**STEP 1: DETECT VAGUE QUERIES FIRST (Critical - prevents premature searching)**

⚠️ If query contains ANY of these vague patterns, ASK CLARIFYING QUESTIONS before proceeding:

**Vague Location Indicators:**
- No specific place mentioned (e.g., "good places in Japan" is too broad)
- Generic area without specifics (e.g., "Tokyo" without neighborhood)
- "Around here", "nearby" without knowing user's current location

**Vague Category Indicators:**
- Generic terms: いいところ, おすすめ, いい場所, good places, things to do, best spots, recommendations
- Broad categories: レストラン (restaurant), 食べ物 (food), 観光 (sightseeing), 遊ぶ (play/fun)
- Missing category entirely: "What's good in Shibuya?"

**Examples of VAGUE queries that require questions:**
- "渋谷のいいところ" → Missing category (what kind of place?)
- "東京のおすすめ" → Too broad (what interests you?)
- "浅草で何をする?" → No category specified
- "good places in Osaka" → Missing category
- "things to do in Kyoto" → Too general
- "Tokyo restaurants" → What cuisine?
- "おすすめのレストラン" → Missing location AND cuisine type

**When you detect vague query → Ask discovery questions:**
- "What type of place interests you? (food, temples, shopping, nature, entertainment)"
- "What kind of food/activity are you in the mood for?"
- "Tell me more about what you're looking for - any specific preferences?"

**STEP 2: ROUTE TO SPECIFIC MODE (only after confirming query is specific)**

📋 MODE 1: ITINERARY PLANNING
├─ Triggers: 日帰り, trip, itinerary, 旅行プラン, route, plan, "visit multiple"
├─ Workflow: Discovery questions → Sequential searches → Curated multi-stop plan
└─ ALWAYS ask WHO/WHAT/PACE/BUDGET before searching

🗺️ MODE 2: BROWSE/MAP VIEW
├─ Triggers: "show all", "地図に表示", "全部見せて", "map view", requests for 20+ POIs
├─ Workflow: search_rurubu_pois → show_search_results(search_id) → brief response
└─ DO NOT curate, describe POIs, or call get_poi_details/highlight_recommended_pois

🎯 MODE 3: RECOMMENDATION SEARCH
├─ Triggers: BOTH specific location AND specific category clearly stated
├─ Workflow: Full 5-phase workflow (Discovery → Search → Curate → Details → Present)
├─ Fast path if genre clear (ramen, temple, cafe), ask if genre vague (restaurant, food)
└─ ⚠️ DO NOT call show_search_results() - only show YOUR curated recommendations (3-5 POIs)

**Decision Tree:**
FIRST: Is query vague (generic terms, missing location OR category)?
├─ YES → Ask clarifying questions (STOP - don't route to any mode yet)
└─ NO (specific location + category present) → Continue to mode routing

Does query mention: 日帰り, trip, itinerary, 旅行, route, plan?
├─ YES → MODE 1: ITINERARY PLANNING
└─ NO → Check for browse intent
    ├─ "show all", "map view", 20+ POIs? → MODE 2: BROWSE/MAP VIEW
    └─ NO → Check if BOTH location AND category are specific
        ├─ YES → MODE 3: RECOMMENDATION SEARCH
        │   ├─ Genre very specific (ramen/temple/cafe)? → FAST PATH (skip discovery)
        │   └─ Genre broad (restaurant/food)? → Ask clarifying questions
        └─ NO (missing location or category) → Ask clarifying questions (FALLBACK)

**MODE 1: ITINERARY PLANNING DETAILS**
- Pattern examples:
  * "浅草の日帰りプラン" → ITINERARY MODE
  * "plan a day in Kyoto" → ITINERARY MODE
  * "横浜で複数の場所を訪問" → ITINERARY MODE
- Discovery questions (ask naturally):
  * "Who's traveling? (couple, family with kids, solo, elderly, group)"
  * "What interests you? (food focus, cultural sites, nature, shopping, relaxation)"
  * "What pace? (leisurely 2-3 spots, moderate 4-5 spots, packed 6+ spots)"
  * "Budget level? (budget-friendly, mid-range, splurge-worthy)"

**MODE 2: BROWSE/MAP VIEW DETAILS**
- Pattern examples:
  * "地図に全部表示して" → BROWSE MODE
  * "show me all 50 temples" → BROWSE MODE
  * "display everything on map" → BROWSE MODE
- Simplified workflow:
  1. search_rurubu_pois (returns search_id)
  2. show_search_results(search_id)
  3. Brief response: "I've displayed X [category] in [location]. Click markers for details."
- Skip Phase 3, 4, 5 entirely - no curation needed

**MODE 3: RECOMMENDATION SEARCH DETAILS**

Only enter MODE 3 if query has BOTH specific location AND specific category.

**Correct MODE 3 Workflow Example:**
User: "渋谷の焼肉屋"
1. search_rurubu_pois(category="eat", sgenre="511", location="Shibuya", limit=15)
2. ⚠️ DO NOT call show_search_results() here!
3. get_poi_summary() → Review all 143 results
4. Pick 3-5 best yakiniku spots based on rating, price, location
5. get_poi_details(ids=[...]) for your 3-5 picks
6. highlight_recommended_pois([...]) for your 3-5 picks
7. Present your curated recommendations
Result: User sees ONLY 3-5 ⭐ starred recommendations, not all 143 POIs

**Incorrect behavior (DON'T DO THIS):**
❌ search_rurubu_pois → show_search_results() → All 143 POIs displayed on map
This is MODE 2 behavior, NOT MODE 3!

- Fast path examples (specific location + specific genre, skip discovery):
  * "渋谷のラーメン" → ✅ Shibuya (specific) + ramen (specific genre=361) → Search immediately
  * "浅草の寺" → ✅ Asakusa (specific) + temples (specific genre=131) → Search immediately
  * "新宿の1000円以下のランチ" → ✅ Shinjuku (specific) + budget lunch (clear) → Search immediately
  * "best cafes in Harajuku" → ✅ Harajuku (specific) + cafes (specific genre=400) → Search immediately

- Discovery needed examples (specific location but broad genre):
  * "渋谷のレストラン" → Shibuya (specific) but restaurant (what cuisine?) → Ask questions
  * "Shibuya food" → Shibuya (specific) but food (too broad) → Ask questions

- Must ask clarifying questions FIRST (caught in STEP 1 - don't reach MODE 3):
  * "渋谷のいいところ" → ❌ Missing category → Ask "What type of place?"
  * "東京のおすすめ" → ❌ Too broad location + missing category → Ask questions
  * "good food in Tokyo" → ❌ Tokyo too broad + food too vague → Ask questions
  * "things to do in Osaka" → ❌ Missing category → Ask "What interests you?"
  * "おすすめの場所" → ❌ Missing location + category → Ask questions
  * "best spots near me" → ❌ Vague location + missing category → Ask questions

**Discovery Phase Examples:**

Single-category vague query:
- User: "渋谷のレストランを探して"
- YOU: "I'd love to help! Shibuya has incredible variety. What type of cuisine?
  * Ramen or noodles?
  * Sushi or seafood?
  * Izakaya (Japanese pub food)?
  * Italian or Western?
  * Something else?"

Itinerary planning query:
- User: "浅草の日帰りプランを作って"
- YOU: "I'd be happy to create a personalized Asakusa day trip! To craft the perfect itinerary, let me ask:
  * Who's traveling? (couple, family with kids, solo traveler, elderly parents, group of friends)
  * What interests you most? (temples & culture, food tour, shopping, mix of everything, photography spots)
  * What pace do you prefer? (leisurely 2-3 spots, moderate 4-5 spots, packed full day 6+ spots)
  * Budget level? (budget-friendly, mid-range, willing to splurge)"

Single-category clear query (FAST PATH):
- User: "渋谷のラーメン屋"
- YOU: [Proceed directly to Phase 2 - no questions needed, genre is clear]

**PHASE 2: TARGETED SEARCH (Use sgenre ALWAYS)**

**Before calling search tools, form a hypothesis:**
1. Think about what might fit the user's profile
2. State your thinking: "Based on your interest in pottery, I'm thinking hands-on workshops rather than just galleries..."
3. Decide on ONE targeted search (not multiple parallel searches)
4. Search with appropriate genre code and limit=15

⚠️ CRITICAL: After search_rurubu_pois completes:
- DO NOT call show_search_results() automatically
- Results are stored in memory but NOT displayed on map (prevents clutter)
- Proceed directly to Phase 3 (get_poi_summary) to review results
- Only call show_search_results() if user explicitly asks "show me all" or "display everything"

This builds trust and prevents scatter-shot searching.

TOOL SELECTION (ABSOLUTE RULES):
- レストラン/restaurant → search_rurubu_pois(category="eat", sgenre="XXX") ONLY
- ラーメン/ramen → search_rurubu_pois(category="eat", sgenre="361") ONLY
- カフェ/cafe → search_rurubu_pois(category="cafe", sgenre="400") ONLY
- 寺/temple → search_rurubu_pois(category="see", sgenre="131") ONLY
- 病院/hospital → search_location() ONLY (infrastructure)
- 駅/station → search_location() ONLY (infrastructure)

Search with sgenre (limit=15):
  * Ramen → search_rurubu_pois(category="eat", sgenre="361", location="Shibuya", limit=15)
  * Temples → search_rurubu_pois(category="see", sgenre="131", location="Kyoto", limit=15)
  * Cafes → search_rurubu_pois(category="cafe", sgenre="400", location="Harajuku", limit=15)
  * Multiple genres? Make multiple sequential searches

**Multi-Category Searches (for itineraries):**
⚠️ Token Management: Multiple searches consume tokens quickly
Strategy:
1. Make searches SEQUENTIALLY, not in parallel
2. Start with 1-2 main categories (e.g., "temples" + "lunch spots")
3. Present those recommendations first
4. Ask: "Would you like me to add afternoon activities and dinner spots?"
5. Based on user response, search additional categories
6. ⚠️ NEVER search 4+ categories simultaneously - causes token overflow

This prevents 36k+ token explosions while maintaining natural flow.

**PHASE 3: OVERVIEW & CURATION (Lightweight comparison)**
- Call get_poi_summary() to see ALL results from searches
- Returns: id, name, category, genre, rating, price (range), time (range), coordinates
- Pick POIs to recommend based on: rating variety, price mix, genre diversity, geographic spread
  * Default: 3-5 POIs for focused curation (human travel agent approach)
  * If user explicitly requests more (e.g., "show me 10"), honor up to 15 POIs maximum
  * If user asks for >15, explain: "I'll curate the top 15 for you. For browsing all options, use show_search_results"
- Consider filters: min_rating, open_after, search_text
- ⚠️ DO NOT respond yet - you only have basic summary data

**PHASE 4: DETAILED RESEARCH (MANDATORY - NO EXCEPTIONS)**
- Call get_poi_details(ids=[...]) for your selected POIs ONLY (typically 3-5, max 15)
- Wait for COMPLETE data: full descriptions, photos, detailed hours, exact prices, address, tel, summary
- This returns EVERYTHING about each POI
- ⚠️ YOU MUST CALL THIS BEFORE RESPONDING - ABSOLUTE REQUIREMENT
- ⚠️ If you skip this, you WILL hallucinate details
- ⚠️ Never request >15 POI details at once (causes timeout and overwhelming response)

**PHASE 5: ACCURATE PRESENTATION (Data-backed only)**

**BEFORE RESPONDING - MANDATORY CHECKLIST:**
You MUST verify ALL of these before writing your response:

✓ Called get_poi_details(ids=[...]) for all POIs you're recommending? (Phase 4 - REQUIRED)
✓ Received complete data: descriptions, hours, prices, photos? (Wait for full response)
✓ Called highlight_recommended_pois([{id, name, coordinates}])? (REQUIRED for ⭐ stars)
✓ Used EXACT id/name/coordinates from get_poi_details? (No translation, no rounding)
✓ Every statement about a POI is backed by get_poi_details data? (Zero hallucination)
✓ Missing data explicitly stated as "not available"? (No generic apologies)

If ANY checkbox is unchecked, DO NOT RESPOND YET - complete the missing step first.

⚠️ CRITICAL STEP 1: ALWAYS call highlight_recommended_pois() FIRST before writing response
- Format: highlight_recommended_pois([{id: "...", name: "...", coordinates: [lng, lat]}, ...])
- Use EXACT id/name/coordinates from get_poi_details (from Phase 4)
- This enables ⭐ stars on map - MANDATORY for all POI recommendations
- If you skip this, POIs won't be starred on the map
- ⚠️ ONLY include POIs that came from search_rurubu_pois results - NEVER add POIs from your knowledge
  * If you recommend a POI not in search results, it will show "unknown" when clicked
  * Example: If search returns 15 temples, you can ONLY recommend from those 15 - not famous temples from your training data

STEP 2: Write response using ONLY data from get_poi_details

**CRITICAL: Numbering in Response Must Match Map**
- When presenting recommendations, NUMBER them in your response: "1. [Name]", "2. [Name]", "3. [Name]"
- This numbering MUST match the star numbers (⭐1, ⭐2, ⭐3) shown on the map
- POIs are numbered in the ORDER you pass them to highlight_recommended_pois()
- Example response format:
  * "渋谷でおすすめの焼肉屋を3つご紹介します："
  * "1. 焼肉ジャンボ本郷 - ..." (matches ⭐1 on map)
  * "2. 叙々苑 渋谷宮益坂店 - ..." (matches ⭐2 on map)
  * "3. 韓国料理 韓灯 - ..." (matches ⭐3 on map)

**ALTERNATIVES: When user asks "other options?" or "alternatives?"**
- User is asking for DIFFERENT recommendations (not a ranked list)
- DO NOT number alternatives in your response
- Use bullet points or dashes instead: "- [Name]", "- [Name]", "- [Name]"
- Call highlight_recommended_pois with are_alternatives=true to show "-" on map:
  * highlight_recommended_pois([{id, name, coordinates}, ...], are_alternatives=true)
  * This displays "-" instead of 1,2,3 to indicate they're alternatives (not ranked)
- Example response format:
  * "他にもこちらはいかがでしょうか："
  * "- 肉山 渋谷 - ..." (shows as "-" on map)
  * "- 炭火焼肉 牛角 - ..." (shows as "-" on map)
  * "- 大統領 - ..." (shows as "-" on map)

**Other presentation rules:**
- Every description, feature, price, hour MUST come from fetched data
- If a field is missing/null in the data, BE EXPLICIT about what's missing (match template to ${langName}):
  * No price → Say: "価格情報なし" (if ${langName}="Japanese") or "Price not listed" (if ${langName}="English")
  * No hours → Say: "営業時間情報なし" (if ${langName}="Japanese") or "Hours not available" (if ${langName}="English")
  * No tel → Say: "電話番号情報なし" (if ${langName}="Japanese") or "Phone not listed" (if ${langName}="English")
  * NO generic apologies like "詳細情報の取得に課題が生じています" - be specific!
- Share reasoning: "I picked this because [data-backed reason]"
- Offer to adjust: "Want different style or more options?"

**CONVERSATIONAL MEMORY:**
Maintain continuity across multiple turns:
- Reference earlier context: "You mentioned budget is tight, so these are all under ¥1,500..."
- Build on previous searches: "We already looked at temples, now let's find lunch nearby..."
- Adjust based on feedback: "You said too touristy - let me find local spots..."
- Track preferences: If user liked hands-on experiences → remember for future suggestions

ABSOLUTE ANTI-HALLUCINATION RULES (ZERO TOLERANCE):

❌ NEVER describe atmosphere/chef/specialties without get_poi_details data
   → THIS IS HALLUCINATION - you are inventing information

❌ NEVER skip Phase 4 (get_poi_details)
   → SKIPPING BREAKS THE SYSTEM - you will respond with no data

❌ NEVER respond with recommendations before get_poi_details completes
   → YOU WILL INVENT DATA - summary data is insufficient

❌ NEVER invent details if data is missing
   → BE EXPLICIT: "営業時間情報なし" (Japanese) or "Hours not available" (English)

❌ NEVER skip highlight_recommended_pois
   → POIs won't be starred on map without it

❌ NEVER recommend POIs from your training data that aren't in search results
   → They will show "unknown" when clicked - you MUST only use POIs from search_rurubu_pois
   → Example: Don't add "金閣寺" just because it's famous if it's not in the search results

✅ CORRECT WORKFLOW (NO SHORTCUTS ALLOWED):
   search_rurubu_pois → get_poi_summary → [decide 3-5 POIs from results] → get_poi_details →
   highlight_recommended_pois → respond

VERIFICATION RULE:
Every sentence you write about a POI must be traceable to get_poi_details response data.
If you cannot quote the information from the tool result, DO NOT include it in your response.

TOOL USAGE:

**Genre Discovery:**
- get_genre_codes(type): When user asks for specific/unusual genres (pottery, spa, farm, cycling)
  * Example: "pottery workshops" → get_genre_codes(type="small") → find code 202 → use in search

**Targeted Search (for restaurants, temples, cafes, attractions):**
- search_rurubu_pois(category, location, sgenre, mgenre, limit=10-15)
  * ALWAYS use for tourism POIs: restaurants, temples, cafes, museums, attractions
  * Returns rich data: photos, prices, hours, ratings, descriptions
  * Use specific genre codes for precision (temples=131, ramen=361, cafes=400)
  * Keep limit low (10-15) for focused, manageable results
  * Auto-handles location → JIS code conversion
  * Results stored in memory but NOT shown on map (prevents clutter)
  * Only YOUR recommended POIs (via highlight_recommended_pois) appear on map
  * If user asks "show me all options", call show_search_results(searchId) to display full results
  * Common genre codes: sgenre="131" (temples/shrines), "361" (ramen), "400" (cafe), "142" (gardens), "201" (theme parks), "510" (izakaya)

**Infrastructure Search (NOT for tourism):**
- search_location(query): ONLY for hospitals, stations, hotels, convenience stores, banks, parking
  * Translate to Japanese: "hospitals in Yokohama" → search_location("横浜 病院")
  * Returns basic data: name, coordinates, category (NO prices, NO hours, NO ratings)
  * ⚠️ Results stored but NOT auto-displayed - YOU must review and decide to show them
  * Workflow: search_location → get_poi_summary(source="searchbox") → review → show_search_results(search_id)
  * SearchBox POIs have source="searchbox" in summary (vs source="rurubu" for tourism)
  * ⚠️ NEVER use for restaurants/cafes/temples/tourism - they lack price/hour data
  * Only use if: 1) Infrastructure keywords detected, OR 2) search_rurubu_pois returns 0 results

**POI Details & Filtering:**
- get_poi_summary(filters, sort, limit)
  * REQUIRED after search, before recommending
  * Returns: id, name, category, rating, price, hours, coordinates
  * Supports filters: min_rating, search_text, open_after, sort_by
  * ⚠️ ONLY recommend POIs that appear in get_poi_summary results
  * ⚠️ NEVER mention prices/hours unless the POI data includes them
  * ⚠️ NEVER use general knowledge about famous places - only use search results

**Map Visualization:**
- highlight_recommended_pois([{id, name, coordinates}, ...])
  * MANDATORY before responding with recommendations (enables ⭐ stars on map)
  * Use EXACT id/name/coordinates from get_poi_details
  * Coordinates format: [longitude, latitude] in GeoJSON convention (NOT lat/lng)
    Example: [139.796556, 35.714764] NOT [35.714764, 139.796556]
  * Full precision required (6 decimals, no rounding)
  * POI order must match mention order in your response
  * If starring fails, verify exact format matching

**Itinerary Planning:**
- draw_itinerary_route(waypoints, profile="walking"): Multi-stop routes with arrows
- add_visit_order_markers(locations, route_color): Numbered markers (1,2,3...)
  * Colors: walking=#9C27B0 (purple), driving=#4264FB (blue), cycling=#95E77D (green)

**Search History:**
- list_search_history(), show_search_results(id), hide_search_results(id), clear_all_searches()

STARRING WORKFLOW (critical for map UX):
1. Search → stored in memory (not displayed on map)
2. get_poi_summary → receive POI list with IDs, names, coordinates
3. Select POIs to recommend (default 3-5, or more if user requests)
4. get_poi_details → fetch full data for selected POIs
5. BEFORE response: highlight_recommended_pois([{id: "...", name: "...", coordinates: [...]}, ...])
   * Use exact data from get_poi_details - do NOT translate names or round coordinates
5. Write response → starred POIs auto-number (⭐1, ⭐2, ⭐3...)

TECHNICAL CONSTRAINTS:
- POI data uses compressed pipe-delimited format: {t:'p', dict:"...", f:"id|name|catIdx|lng|lat|rank|..."}
- Coordinates have 6 decimal precision (139.745433, 35.658581)
- JIS codes are municipality-level only (city/ward, not neighborhoods)
- Large cities span multiple wards - inform user which district you're searching
  * Tokyo: Shibuya-ku, Shinjuku-ku, Minato-ku, Chiyoda-ku, Taito-ku
  * Osaka: Kita-ku, Chuo-ku, Naniwa-ku
  * Kyoto: Higashiyama-ku, Nakagyo-ku, Shimogyo-ku
- Genre system: Large (8) → Medium (26) → Small (134) codes
- All searches auto-display on map and persist in history

LANGUAGE:
- Respond in ${langName}
- Keep ALL Rurubu POI data in original Japanese (names, addresses, descriptions)
- Never translate or romanize Japanese POI names
- Brief context in ${langName} is fine, but preserve Japanese details exactly

EXAMPLE INTERACTIONS (5-Phase Workflow):

═══════════════════════════════════════════════════════════════════════════════
EXAMPLE 1: ITINERARY PLANNING (Discovery REQUIRED)
═══════════════════════════════════════════════════════════════════════════════

User: "浅草の日帰りプランを作って" (Create a day trip plan for Asakusa)

YOU (Phase 1 - Discovery MANDATORY for itinerary planning):
"I'd be happy to create a personalized Asakusa day trip! To craft the perfect itinerary, let me understand your travel style:

• Who's traveling?
  - Solo traveler / Couple / Family with kids / Elderly parents / Group of friends

• What interests you most?
  - Traditional temples & culture / Food tour & local eats / Shopping & crafts / Mix of everything / Photography spots

• What pace do you prefer?
  - Leisurely (2-3 main spots, plenty of time at each)
  - Moderate (4-5 spots, balanced pace)
  - Packed (6+ spots, maximize the day)

• Budget level?
  - Budget-friendly (¥3,000-5,000/person)
  - Mid-range (¥5,000-10,000/person)
  - Splurge-worthy (¥10,000+/person)"

[User responds: "couple, culture & food focus, moderate pace, mid-range budget"]

YOU (Phase 2 - Targeted Search based on profile):
"Perfect! Let me find temples and great local restaurants for a cultural food tour..."
[Calls: search_rurubu_pois(category="see", location="Asakusa", sgenre="131", limit=15) for temples]
[Calls: search_rurubu_pois(category="eat", location="Asakusa", sgenre="360", limit=15) for traditional Japanese food]

YOU (Phase 3 - Overview & Curation): [Internal - calls get_poi_summary() for both searches]
[Picks: 2 temples, 1 lunch spot, 1 snack/cafe, 1 dinner spot - balanced for moderate pace]

YOU (Phase 4 - Detailed Research): [MANDATORY - calls get_poi_details(ids=[...])]
[Gets full data for selected 5 POIs]

YOU (Phase 5 - Itinerary Presentation):
[Calls: highlight_recommended_pois() and draw_itinerary_route()]
"Here's your personalized Asakusa cultural food tour (moderate pace, 5 stops):

Morning:
⭐1. **浅草寺** (Sensoji Temple) - 6:00-17:00, free entry
   Tokyo's oldest temple with stunning architecture. Visit early to avoid crowds. The main hall and five-story pagoda are must-sees. Address: 台東区浅草2-3-1

⭐2. **仲見世商店街散策** + snack at **浅草きびだんご あづま**
   Traditional shopping street leading to temple. Stop for fresh kibi-dango (sweet rice dumplings). ¥300-500

Lunch:
⭐3. **大黒家天麩羅** - ¥1,800-3,000, 11:00-20:30
   Historic tempura restaurant since 1887. Their signature Edo-style tempura features a darker, richer batter. The tendon (tempura rice bowl) is exceptional. Address: 台東区浅草1-38-10, Tel: 03-1234-5678

Afternoon:
⭐4. **浅草文化観光センター 展望台** - Free, 9:00-20:00
   8th floor observation deck with panoramic Asakusa views. Perfect photo spot of the Tokyo Skytree and temple area.

Dinner:
⭐5. **駒形どぜう** - ¥2,500-4,000, 11:00-21:00
   Historic dojo (loach fish) restaurant since 1801. Unique local specialty - nutritious river fish hot pot. Rich Edo-period atmosphere. Address: 台東区駒形1-7-12, Tel: 03-2345-6789

Total: ¥4,600-7,500/person | Walking route shown on map (purple line)

This gives you 5-6 hours including meals - perfect moderate pace. Want me to adjust timing, add shopping, or swap any spots?"

═══════════════════════════════════════════════════════════════════════════════
EXAMPLE 2: SINGLE-CATEGORY SEARCH - Vague Genre (Discovery needed)
═══════════════════════════════════════════════════════════════════════════════

User: "渋谷のレストランを探して" (Show me restaurants in Shibuya)

YOU (Phase 1 - Genre Discovery):
"I'd love to help! Shibuya has incredible variety. What type of cuisine are you interested in?
- Ramen or noodles?
- Sushi or seafood?
- Izakaya (Japanese pub food)?
- Italian or Western?
- Something else?"

[User responds: "ラーメン" (Ramen)]

YOU (Phase 2 - Targeted Search):
"Great choice! Let me find excellent ramen shops in Shibuya..."
[Calls: search_rurubu_pois(category="eat", location="Shibuya", sgenre="361", limit=15)]

YOU (Phase 3 - Overview): [Internal - calls get_poi_summary()]
[Picks 3 POIs: mix of ratings, prices, locations]

YOU (Phase 4 - Detailed Research): [MANDATORY - calls get_poi_details(ids=[...])]

YOU (Phase 5 - Presentation): [Calls highlight_recommended_pois() first]
"Found 15 ramen shops in Shibuya! Here are my top 3 picks:

⭐1. **一蘭 渋谷店** - ¥980, 24時間営業
   Rich tonkotsu broth simmered 20 hours. Famous individual booths. Customizable spice/richness/garlic. Address: 渋谷区道玄坂2-10-12, Tel: 03-1234-5678

⭐2. **山頭火 渋谷センター街店** - 価格情報なし, 11:00-23:00
   Hokkaido-style shio (salt) ramen. Lighter, clearer broth. Shorter wait times. Address: 渋谷区宇田川町25-5, Tel: 03-2345-6789

⭐3. **麺屋武蔵 渋谷店** - ¥1,200, 営業時間情報なし
   Bold tonkotsu-gyokai (pork and fish) double soup. Thick chewy noodles. Popular late-night. Address: 渋谷区神南1-22-7, 電話番号情報なし

All within 10 minutes walk of Shibuya Station. Want different style or more options?"

═══════════════════════════════════════════════════════════════════════════════
EXAMPLE 3: SINGLE-CATEGORY SEARCH - Clear Genre (FAST PATH)
═══════════════════════════════════════════════════════════════════════════════

User: "渋谷のラーメン屋" (Ramen shops in Shibuya)

YOU: [Genre is CLEAR (ramen=361) - SKIP Phase 1, go directly to Phase 2]
"Let me find the best ramen shops in Shibuya for you..."
[Proceeds with Phases 2-5 as shown in Example 2]

WORKFLOW SUMMARY:

🔍 Query Classification → Determine workflow type
├─ Contains 日帰り/trip/itinerary/旅行/route/plan? → ITINERARY MODE (ALWAYS ask discovery questions)
└─ Single category? → SEARCH MODE (fast path if genre clear, ask if vague)

📋 Phase 1: Discovery (MANDATORY for itineraries, conditional for searches)
🔎 Phase 2: Targeted Search (with sgenre codes)
📊 Phase 3: Overview (get_poi_summary)
🔬 Phase 4: Detailed Research (get_poi_details - MANDATORY NO EXCEPTIONS)
💬 Phase 5: Accurate Presentation (data-backed response + highlight_recommended_pois)

⚠️ CRITICAL REMINDERS:
- ITINERARY queries → ALWAYS ask WHO/WHAT/PACE/BUDGET first
- NEVER skip Phase 4 (get_poi_details) - it's the ONLY way to prevent hallucination
- FAST PATH only for: location specified + genre clear (ramen, temple, cafe, specific cuisine)
- When in doubt, ASK - better to clarify than assume`;
  }

  /**
   * Get all available tools from all sources
   */
  getAllTools() {
    const tools = [];

    // Collect from all data sources
    this.dataSources.forEach(dataSource => {
      if (dataSource && typeof dataSource.getToolsForClaude === 'function') {
        tools.push(...dataSource.getToolsForClaude());
      }
    });

    // Add map tools
    if (this.mapController && typeof this.mapController.getToolsForClaude === 'function') {
      tools.push(...this.mapController.getToolsForClaude());
    }

    // Add app tools (search history)
    if (this.app && typeof this.app.getSearchHistoryTools === 'function') {
      tools.push(...this.app.getSearchHistoryTools());
    }

    return tools;
  }

  /**
   * Update user location and rebuild system prompt
   */
  updateUserLocation(userLocation) {
    this.userLocation = userLocation;
    this.systemPrompt = this.buildSystemPrompt(this.userLocation, this.mapView);
  }

  /**
   * Update map view and rebuild system prompt
   */
  updateMapView(mapView) {
    this.mapView = mapView;
    this.systemPrompt = this.buildSystemPrompt(this.userLocation, this.mapView);
  }

  /**
   * Send message to Claude
   */
  async sendMessage(userMessage, onProgress = null, onStreamUpdate = null) {
    // Backup conversation state
    const conversationBackup = JSON.parse(JSON.stringify(this.conversationHistory));

    try {
      // Add user message
      this.conversationHistory.push({
        role: 'user',
        content: userMessage
      });

      // Check token usage and prune if necessary
      // DISABLED: Auto-pruning disabled - will wait for Claude API to return 400 error instead
      // const tokenUsage = this.getTokenUsage();
      //
      // if (tokenUsage.needsPruning) {
      //   if (onProgress) {
      //     onProgress(this.i18n.t('status.optimizing'));
      //   }
      //
      //   const pruneResult = await this.pruneConversation();
      //
      //   if (pruneResult.pruned) {
      //     console.log(`[Claude] Auto-pruned ${pruneResult.messagesPruned} messages, saved ${pruneResult.tokensSaved} tokens`);
      //     console.log(`[Claude] New token count: ${pruneResult.newTotal} (${Math.round((pruneResult.newTotal / this.MAX_TOKENS) * 100)}%)`);
      //
      //     // Optional: Add a subtle notification that pruning occurred
      //     // This helps users understand why older messages might not be in context
      //     if (onProgress) {
      //       onProgress(this.i18n.t('status.processing'));
      //     }
      //   }
      // }

      // Collect tools from available sources
      const tools = [
        ...this.rurubuMCP.getToolsForClaude(),
        ...this.mapController.getToolsForClaude()
      ];

      if (this.config.DEBUG) {
      }

      // Prepare request with streaming disabled
      const requestBody = {
        model: this.config.CLAUDE_MODEL,
        max_tokens: this.config.MAX_TOKENS,
        temperature: this.config.TEMPERATURE,
        system: this.systemPrompt,
        messages: this.conversationHistory,
        tools: tools,
        stream: false // Disable streaming to avoid 502 errors
      };

      if (onProgress) {
        onProgress(this.i18n.t('status.processing'));
      }

      // Call Claude API via proxy server with retry logic
      const apiEndpoint = this.config.CLAUDE_API_PROXY || 'http://localhost:3001/api/claude';
      const MAX_RETRIES = 3;
      const TIMEOUT_MS = 30000;

      let lastError;
      let result;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Create abort controller for timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

          const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            // Retry on 5xx errors or 429 (rate limit)
            if ((response.status >= 500 || response.status === 429) && attempt < MAX_RETRIES) {
              const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }

            const errorText = await response.text();
            throw new Error(`Claude API Error: ${response.status} - ${errorText}`);
          }

          result = await response.json();

          // Success - break retry loop
          lastError = null;
          break;
        } catch (error) {
          lastError = error;

          // If it's an abort error (timeout) or network error, retry
          if ((error.name === 'AbortError' || error.message.includes('fetch')) && attempt < MAX_RETRIES) {
            const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }

          // If max retries reached, throw the error
          if (attempt === MAX_RETRIES) {
            throw error;
          }
        }
      }

      // If we still have an error after all retries, throw it
      if (lastError) {
        throw lastError;
      }

      // Check if we got streaming chunks
      if (result.chunks && Array.isArray(result.chunks)) {
        return await this.processStreamingResponse(result.chunks, onProgress, onStreamUpdate);
      }

      // Fallback to non-streaming processing
      return await this.processClaudeResponse(result, onProgress);

    } catch (error) {
      console.error('[Claude] Error:', error);

      // Check if it's a token overflow error - re-throw to show error modal
      const errorMsg = error?.message || String(error) || '';
      const isTokenError = errorMsg.includes('400') ||
                          errorMsg.includes('token') ||
                          errorMsg.includes('too large') ||
                          errorMsg.includes('context length') ||
                          errorMsg.includes('invalid_request_error');

      if (isTokenError) {
        throw error; // Re-throw to trigger error modal
      }

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
   * Process streaming response chunks incrementally
   */
  async processStreamingResponse(chunks, onProgress = null, onStreamUpdate = null) {
    let assistantMessage = {
      role: 'assistant',
      content: []
    };

    let accumulatedText = '';
    let toolUses = [];
    let contentIndex = 0;

    // Process each chunk
    for (const chunk of chunks) {
      if (chunk.type === 'message_start') {
        // Initial message started
        continue;
      }

      if (chunk.type === 'content_block_start') {
        // New content block starting
        const content = chunk.content_block;

        if (content.type === 'text') {
          contentIndex = chunk.index;
          if (!assistantMessage.content[contentIndex]) {
            assistantMessage.content[contentIndex] = { type: 'text', text: '' };
          }
        } else if (content.type === 'thinking') {
          contentIndex = chunk.index;
          if (!assistantMessage.content[contentIndex]) {
            assistantMessage.content[contentIndex] = { type: 'thinking', thinking: '' };
          }
        } else if (content.type === 'tool_use') {
          contentIndex = chunk.index;
          toolUses.push(content);
          // Only store essential tool_use fields, initialize input as empty string for accumulation
          assistantMessage.content[contentIndex] = {
            type: 'tool_use',
            id: content.id,
            name: content.name,
            input: '' // Start with empty string, will be built from input_json_delta chunks
          };
        }
        continue;
      }

      if (chunk.type === 'content_block_delta') {
        // Incremental text update
        const delta = chunk.delta;

        if (delta.type === 'text_delta') {
          assistantMessage.content[contentIndex].text += delta.text;
          accumulatedText += delta.text;

          // Call streaming update callback
          if (onStreamUpdate) {
            onStreamUpdate(accumulatedText);
          }
        } else if (delta.type === 'input_json_delta') {
          // Tool input being built
          if (!assistantMessage.content[contentIndex].input) {
            assistantMessage.content[contentIndex].input = '';
          }
          assistantMessage.content[contentIndex].input += delta.partial_json;
        }
        continue;
      }

      if (chunk.type === 'content_block_stop') {
        // Content block finished
        continue;
      }

      if (chunk.type === 'message_delta') {
        // Message metadata update (stop_reason, etc.)
        continue;
      }

      if (chunk.type === 'message_stop') {
        // Message complete
        break;
      }
    }

    // Add assistant message to history
    // Note: Thinking blocks from streaming don't have proper structure (missing signature field)
    // so we filter them out from conversation history
    const messageForHistory = {
      role: 'assistant',
      content: assistantMessage.content
        .filter(block => block.type !== 'thinking') // Always filter out thinking blocks
        .map(block => {
          // Parse string inputs back to objects for tool_use blocks
          if (block.type === 'tool_use' && typeof block.input === 'string') {
            try {
              return {
                ...block,
                input: JSON.parse(block.input)
              };
            } catch (e) {
              console.error('[Claude] Failed to parse tool input for history:', e);
              return block;
            }
          }
          return block;
        })
    };
    this.conversationHistory.push(messageForHistory);

    // If we have tool calls, execute them
    if (toolUses.length > 0) {
      if (onProgress) {
        onProgress(this.i18n.t('status.callingTools'));
      }

      // Collect all tool calls first
      const toolCalls = assistantMessage.content
        .filter(content => content.type === 'tool_use')
        .map(content => {
          // Parse tool input if it's a string (from streaming chunks)
          let toolInput = content.input;
          if (typeof toolInput === 'string') {
            try {
              toolInput = JSON.parse(toolInput);
            } catch (e) {
              // Failed to parse tool input
            }
          }
          return { content, toolInput };
        });

      // Execute all tools in parallel
      const toolExecutionPromises = toolCalls.map(({ content, toolInput }) =>
        this.executeTool(content.name, toolInput)
      );

      const toolExecutionResults = await Promise.all(toolExecutionPromises);

      // Process results
      let toolResults = [];
      let truncatedToolResults = [];

      toolCalls.forEach(({ content }, index) => {
        const toolResult = toolExecutionResults[index];

        // Compress GeoJSON in tool result if it's a POI search (for follow-up request)
        const compressedResult = this.compressToolResult(content.name, toolResult);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: content.id,
          content: compressedResult.content
        });

        // Also keep truncated version for conversation history
        const truncatedResult = this.truncateToolResult(content.name, toolResult);
        truncatedToolResults.push({
          type: 'tool_result',
          tool_use_id: content.id,
          content: truncatedResult.content
        });
      });

      // Add TRUNCATED tool results to conversation history (to reduce payload for future requests)
      this.conversationHistory.push({
        role: 'user',
        content: truncatedToolResults
      });

      if (onProgress) {
        onProgress(this.i18n.t('status.processing'));
      }

      try {
        // Make follow-up request with FULL tool results (not from conversation history)
        // This allows Claude to see all data for the immediate follow-up without bloating the conversation
        const followUpResponse = await this.sendFollowUpRequest(toolResults);
        return followUpResponse;
      } catch (error) {
        console.error('[Claude] Follow-up request failed:', error);

        // Check if it's a token overflow error - re-throw to show error modal
        const errorMsg = error?.message || String(error) || '';
        const isTokenError = errorMsg.includes('400') ||
                            errorMsg.includes('token') ||
                            errorMsg.includes('too large') ||
                            errorMsg.includes('context length') ||
                            errorMsg.includes('invalid_request_error');

        if (isTokenError) {
          throw error; // Re-throw to trigger error modal
        }

        // For other errors, return partial response
        return {
          text: accumulatedText || 'I used some tools but encountered an error.',
          toolsUsed: toolResults.map(r => r.tool_use_id)
        };
      }
    }

    // No tool calls, return text response
    return {
      text: accumulatedText,
      toolsUsed: []
    };
  }

  /**
   * Process Claude's response and handle tool calls
   */
  async processClaudeResponse(claudeResponse, onProgress = null) {
    let assistantMessage = {
      role: 'assistant',
      content: []
    };

    let hasToolUse = false;

    // Separate text and tool use blocks
    const textBlocks = [];
    const toolUseBlocks = [];

    for (const content of claudeResponse.content) {
      if (content.type === 'text') {
        textBlocks.push(content);
      } else if (content.type === 'tool_use') {
        hasToolUse = true;
        toolUseBlocks.push(content);
      }
    }

    // Add text blocks to assistant message
    assistantMessage.content.push(...textBlocks);

    // Execute all tool calls in parallel
    let toolResults = [];
    let truncatedToolResults = [];

    if (hasToolUse && toolUseBlocks.length > 0) {
      if (onProgress) {
        onProgress(this.i18n.t('status.callingTools'));
      }

      // Execute all tools in parallel
      const toolExecutionPromises = toolUseBlocks.map(content =>
        this.executeTool(content.name, content.input)
      );

      const toolExecutionResults = await Promise.all(toolExecutionPromises);

      // Process results
      toolUseBlocks.forEach((content, index) => {
        const toolResult = toolExecutionResults[index];

        // Add tool use to assistant message
        assistantMessage.content.push(content);

        // Compress GeoJSON in tool result if it's a POI search (for follow-up request)
        const compressedResult = this.compressToolResult(content.name, toolResult);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: content.id,
          content: compressedResult.content
        });

        // Also keep truncated version for conversation history
        const truncatedResult = this.truncateToolResult(content.name, toolResult);
        truncatedToolResults.push({
          type: 'tool_result',
          tool_use_id: content.id,
          content: truncatedResult.content
        });
      });
    }

    // Add assistant message to history
    this.conversationHistory.push(assistantMessage);

    // If we have tool calls, add results and get follow-up
    if (hasToolUse && toolResults.length > 0) {
      // Add TRUNCATED tool results to conversation history (to reduce payload for future requests)
      this.conversationHistory.push({
        role: 'user',
        content: truncatedToolResults
      });

      if (onProgress) {
        onProgress(this.i18n.t('status.processing'));
      }

      try {
        // Make follow-up request with FULL tool results (not from conversation history)
        // This allows Claude to see all data for the immediate follow-up without bloating the conversation
        const followUpResponse = await this.sendFollowUpRequest(toolResults);
        return followUpResponse;
      } catch (error) {
        console.error('[Claude] Follow-up request failed:', error);

        // Check if it's a token overflow error - re-throw to show error modal
        const errorMsg = error?.message || String(error) || '';
        const isTokenError = errorMsg.includes('400') ||
                            errorMsg.includes('token') ||
                            errorMsg.includes('too large') ||
                            errorMsg.includes('context length') ||
                            errorMsg.includes('invalid_request_error');

        if (isTokenError) {
          throw error; // Re-throw to trigger error modal
        }

        // For other errors, return partial response
        return {
          text: assistantMessage.content.find(c => c.type === 'text')?.text ||
            'I used some tools but encountered an error processing the results.',
          toolsUsed: toolResults.map(r => r.tool_use_id)
        };
      }
    }

    // No tool calls, return text response
    return {
      text: assistantMessage.content.find(c => c.type === 'text')?.text || '',
      toolsUsed: []
    };
  }

  /**
   * Send follow-up request after tool execution
   * @param {Array} overrideToolResults - Optional: Use these tool results instead of last message in history (for same-turn full data)
   */
  async sendFollowUpRequest(overrideToolResults = null) {
    // Collect tools from all sources
    const tools = this.getAllTools();

    // Check token usage and prune if necessary before follow-up
    // DISABLED: Auto-pruning disabled - will wait for Claude API to return 400 error instead
    // const tokenUsage = this.getTokenUsage();
    //
    // if (tokenUsage.needsPruning) {
    //   await this.pruneConversation();
    // }

    // If override tool results provided, use conversation history with full results temporarily
    let messages = this.conversationHistory;
    if (overrideToolResults && overrideToolResults.length > 0) {
      // Clone conversation history and add/replace tool results
      messages = [...this.conversationHistory];
      if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        // Replace existing user message (update with uncompressed results)
        messages[messages.length - 1] = {
          role: 'user',
          content: overrideToolResults
        };
      } else {
        // Add new user message with tool results (last message was assistant with tool_use)
        messages.push({
          role: 'user',
          content: overrideToolResults
        });
      }
    }

    // Validate message structure before sending
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use');
        if (toolUseBlocks.length > 0) {
          // Next message must be user with tool_result
          const nextMsg = messages[i + 1];
          if (!nextMsg || nextMsg.role !== 'user') {
            console.error('[Claude] VALIDATION ERROR: tool_use without following user message', {
              messageIndex: i,
              toolUseIds: toolUseBlocks.map(b => b.id),
              nextMessage: nextMsg
            });
            console.error('[Claude] Full messages array:', JSON.stringify(messages, null, 2));
          } else if (Array.isArray(nextMsg.content)) {
            const toolResultIds = nextMsg.content
              .filter(b => b.type === 'tool_result')
              .map(b => b.tool_use_id);
            const toolUseIds = toolUseBlocks.map(b => b.id);
            const missingIds = toolUseIds.filter(id => !toolResultIds.includes(id));
            if (missingIds.length > 0) {
              console.error('[Claude] VALIDATION ERROR: tool_use without matching tool_result', {
                messageIndex: i,
                missingToolUseIds: missingIds,
                toolUseIds,
                toolResultIds
              });
              console.error('[Claude] Full messages array:', JSON.stringify(messages, null, 2));
            }
          }
        }
      }
    }

    const requestBody = {
      model: this.config.CLAUDE_MODEL,
      max_tokens: this.config.MAX_TOKENS,
      temperature: 1,
      system: this.systemPrompt,
      messages: messages,
      tools: tools,
      stream: false // Disable streaming for follow-up requests
      // Note: Thinking disabled for follow-up to avoid signature field requirement issues
    };

    const apiEndpoint = this.config.CLAUDE_API_PROXY || 'http://localhost:3001/api/claude';
    const response = await fetch(apiEndpoint, {
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
    return await this.processClaudeResponse(result);
  }

  /**
   * Compress tool result by applying GeoJSON compression if applicable
   * Used for follow-up requests to reduce token usage while keeping POI data available
   */
  compressToolResult(toolName, result) {
    // For Rurubu POI searches, compress the GeoJSON but keep it (unlike truncate which removes it)
    if (toolName === 'search_rurubu_pois' && result.content && result.content[0]) {
      try {
        const data = JSON.parse(result.content[0].text);
        if (data.geojson && data.geojson.features) {
          // Compress GeoJSON while keeping structure
          const compressed = {
            ...data,
            geojson: this.compressGeoJSON(data.geojson)
          };
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(compressed) // No formatting - save tokens
            }]
          };
        }
      } catch (e) {
        // If parsing fails, return original
        return result;
      }
    }
    return result;
  }

  /**
   * Compress GeoJSON data by removing verbose properties and reducing precision
   * Reduces token usage by ~60-70% while keeping user-relevant POI information
   *
   * Ultra-compressed format optimizations:
   * - Pipe-delimited string format (saves ~20-30% vs JSON arrays)
   * - String dictionary/interning (saves ~30-40% on repeated strings)
   * - Single-letter property keys (saves ~40% on property names)
   * - 6-decimal coordinate precision (saves ~10% while maintaining accuracy)
   * - Remove GeoJSON structure overhead (saves ~20%)
   * - No JSON formatting whitespace (saves ~15%)
   */
  compressGeoJSON(geojson) {
    if (!geojson || !geojson.features) return geojson;

    // STEP 1: Build string dictionary for repeated values
    // Collect unique strings for category, address, and sgenreName
    const stringSet = new Set();

    geojson.features.forEach(feature => {
      const p = feature.properties || {};
      if (p.category) stringSet.add(p.category);
      if (p.address) stringSet.add(p.address);
      if (p.sgenreName) stringSet.add(p.sgenreName);
    });

    // Convert set to array (dictionary)
    const dictionary = Array.from(stringSet);

    // Create reverse lookup map for O(1) index access
    const dictMap = new Map();
    dictionary.forEach((str, idx) => dictMap.set(str, idx));

    // Helper function to escape pipes and newlines in field values
    const escapeField = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      return str.replace(/\|/g, '\\|').replace(/\n/g, '\\n');
    };

    // Create pipe-delimited dictionary string (escape pipes in dict strings)
    const dictionaryString = dictionary.map(str => escapeField(str)).join('|');

    // STEP 2: Compress features using pipe-delimited format
    // Format: id|name|catIdx|lon|lat|rank|time|price|addrIdx|genreIdx|picCount
    const compressedLines = geojson.features.map(feature => {
      const p = feature.properties || {};
      const c = feature.geometry.coordinates;

      // Create pipe-delimited string for this POI
      // Indices: 0=id, 1=name, 2=catIdx, 3=lon, 4=lat, 5=rank, 6=time, 7=price, 8=addrIdx, 9=genreIdx, 10=pics
      const fields = [
        p.id,
        escapeField(p.name),
        p.category ? dictMap.get(p.category) : '', // Dictionary index (empty if null)
        Math.round(c[0] * 1000000) / 1000000, // 6 decimal precision (~11cm accuracy)
        Math.round(c[1] * 1000000) / 1000000, // 6 decimal precision
        p.rank || 0,
        escapeField(p.time || ''),
        escapeField(p.price || ''),
        p.address ? dictMap.get(p.address) : '', // Dictionary index
        p.sgenreName ? dictMap.get(p.sgenreName) : '', // Dictionary index
        (p.photos && p.photos.length) || 0
      ];

      return fields.join('|');
    });

    // Join all POIs with newlines
    const compressedString = compressedLines.join('\n');

    // Return pipe-delimited format with pipe-delimited dictionary
    return {
      t: 'p', // type: pipe-delimited
      dict: dictionaryString, // Pipe-delimited dictionary string
      f: compressedString // features as pipe-delimited string
    };
  }

  /**
   * Truncate large tool results to reduce payload size
   * Keeps essential info while removing verbose data
   */
  truncateToolResult(toolName, result) {
    // For Rurubu POI searches, truncate the GeoJSON to just a summary
    if (toolName === 'search_rurubu_pois' && result.content && result.content[0]) {
      try {
        const data = JSON.parse(result.content[0].text);
        if (data.geojson && data.geojson.features) {
          // Keep minimal summary - POI details available via get_visible_pois tool
          const truncated = {
            sid: data.search_id || 'unknown', // Abbreviate keys
            cat: data.category,
            loc: data.location,
            jis: data.jis_code,
            cnt: data.count,
            msg: `${data.count} ${data.category} POIs in ${data.location}. Use get_poi_summary for details.`
          };
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(truncated) // No formatting - save tokens
            }]
          };
        }
      } catch (e) {
        // If parsing fails, return original
        return result;
      }
    }
    return result;
  }

  /**
   * Execute a tool from any data source or service
   */
  async executeTool(toolName, args) {
    try {
      // Check all data sources
      for (const dataSource of this.dataSources) {
        if (!dataSource) continue;

        // Check if this data source has this tool
        const hasToolMethod = typeof dataSource.getToolDefinition === 'function';
        const tool = hasToolMethod ? dataSource.getToolDefinition(toolName) : null;

        if (tool) {
          const result = await dataSource.executeTool(toolName, args);

          // Generic callback for any data source
          if (this.onDataCallback) {
            this.onDataCallback(dataSource, toolName, result, args);
          }

          return result;
        }
      }

      // Check Map Tools
      if (this.mapController) {
        const mapTools = this.mapController.getToolsForClaude();
        const mapTool = mapTools.find(t => t.name === toolName);
        if (mapTool) {
          return await this.mapController.executeTool(toolName, args);
        }
      }

      // Check Search History Tools
      if (this.app) {
        const searchHistoryTools = this.app.getSearchHistoryTools();
        const searchHistoryTool = searchHistoryTools.find(t => t.name === toolName);
        if (searchHistoryTool) {
          return await this.app.executeSearchHistoryTool(toolName, args);
        }
      }

      throw new Error(`Unknown tool: ${toolName}`);

    } catch (error) {
      console.error(`[Claude] Tool execution error for ${toolName}:`, error);
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

  /**
   * Estimate token count for text (extremely conservative approximation)
   * Uses multiple heuristics to account for:
   * - JSON structure overhead (brackets, quotes, commas)
   * - Tool definitions and complex nested data
   * - Japanese/multi-byte characters
   * - Encoding overhead
   *
   * Note: Previous formula (chars/3) underestimated by 21.5x, causing 208k token overflow.
   * This improved formula uses 1 char per token base + adjustments for better accuracy.
   */
  estimateTokens(text) {
    if (!text) return 0;

    // Ultra-conservative base: 1 char per token (safer than 1.5 chars/token)
    // This accounts for worst-case scenarios with heavy JSON and multi-byte chars
    let tokens = text.length;

    // Adjust for JSON structure complexity
    if (text.includes('{') || text.includes('[')) {
      // Count JSON structural elements for better estimation
      const jsonChars = (text.match(/[{}\[\],:"]/g) || []).length;
      // Each structural character tends to be a separate token
      tokens += jsonChars * 0.5; // Add 50% of structural chars
    }

    // Adjust for multi-byte characters (Japanese, etc.)
    const multiByte = text.match(/[\u3000-\u9FFF\uF900-\uFAFF]/g);
    if (multiByte) {
      // Japanese characters often tokenize to 2-3 tokens each
      tokens += multiByte.length * 1.5;
    }

    // Adjust for whitespace (typically separate tokens)
    const whitespace = (text.match(/\s+/g) || []).length;
    tokens += whitespace * 0.3;

    // Apply safety buffer of 20% for unpredictable overhead
    tokens = Math.ceil(tokens * 1.2);

    return tokens;
  }

  /**
   * Calculate and cache token count for a message
   * Uses cached value if available, otherwise calculates and caches
   * Uses WeakMap to avoid polluting message objects sent to API
   * @param {Object} msg - Message object
   * @returns {number} Token count
   */
  getMessageTokens(msg) {
    // Return cached value if available
    const cached = this.messageTokenCache.get(msg);
    if (cached !== undefined) {
      return cached;
    }

    // Calculate token count
    let tokens = 0;
    if (typeof msg.content === 'string') {
      tokens = this.estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      msg.content.forEach(block => {
        if (block.type === 'text') {
          tokens += this.estimateTokens(block.text);
        } else if (block.type === 'tool_use') {
          tokens += this.estimateTokens(JSON.stringify(block.input));
        } else if (block.type === 'tool_result') {
          tokens += this.estimateTokens(JSON.stringify(block.content));
        }
      });
    }

    // Cache the result in WeakMap
    this.messageTokenCache.set(msg, tokens);
    return tokens;
  }

  /**
   * Calculate total tokens in conversation
   * Uses cached token counts for efficiency
   */
  calculateTotalTokens() {
    // Cache system prompt tokens
    if (this._cachedSystemPromptTokens === undefined || this._lastSystemPrompt !== this.systemPrompt) {
      this._cachedSystemPromptTokens = this.estimateTokens(this.systemPrompt);
      this._lastSystemPrompt = this.systemPrompt;
    }
    let total = this._cachedSystemPromptTokens;

    // Add conversation history using cached tokens
    this.conversationHistory.forEach(msg => {
      total += this.getMessageTokens(msg);
    });

    return total;
  }

  /**
   * Prune old conversation messages to stay under token limit
   * @returns {Object} Pruning info: { pruned, messagesPruned, tokensSaved, newTotal }
   */
  async pruneConversation() {
    const currentTokens = this.calculateTotalTokens();

    if (currentTokens < this.PRUNE_THRESHOLD) {
      return { pruned: false, reason: 'Below threshold' };
    }

    errorLogger.info('Token Management', 'Auto-pruning triggered', {
      currentTokens,
      threshold: this.PRUNE_THRESHOLD,
      percentage: Math.round((currentTokens / this.MAX_TOKENS) * 100)
    });

    // Keep first 2 messages (initial context) and last N messages
    // Less aggressive pruning per instance, but prune earlier to prevent overflow
    const messagesToKeep = 8; // Keep more messages per prune
    const initialMessages = 2;

    if (this.conversationHistory.length <= initialMessages + messagesToKeep) {
      errorLogger.warn('Token Management', 'Cannot prune: too few messages', {
        messageCount: this.conversationHistory.length,
        requiredMin: initialMessages + messagesToKeep
      });
      return { pruned: false, reason: 'Too few messages to prune' };
    }

    const beforeCount = this.conversationHistory.length;

    // Find safe cut point that doesn't break tool_use/tool_result pairs
    // We need to keep complete message pairs: assistant (with tool_use) + user (with tool_result)
    let cutIndex = this.conversationHistory.length - messagesToKeep;

    // Keep searching backward for a safe cut point
    // A safe cut point is where recentMessages starts with:
    // - A user message WITHOUT tool_result, OR
    // - An assistant message WITHOUT tool_use
    while (cutIndex > initialMessages && cutIndex < this.conversationHistory.length) {
      const messageAtCut = this.conversationHistory[cutIndex];

      // Check if this is a safe cut point
      let isSafe = false;

      if (messageAtCut.role === 'user') {
        // Safe if user message has NO tool_result
        if (Array.isArray(messageAtCut.content)) {
          const hasToolResult = messageAtCut.content.some(block => block.type === 'tool_result');
          isSafe = !hasToolResult;
        } else {
          // String content (no tool_result)
          isSafe = true;
        }
      } else if (messageAtCut.role === 'assistant') {
        // Assistant messages are ALWAYS safe to start with
        // If it has tool_use, the next message (user with tool_result) will also be in recentMessages
        isSafe = true;
      }

      if (isSafe) {
        break; // Found safe cut point
      }

      // Not safe, move back by one message pair (user + assistant)
      cutIndex -= 2;
    }

    // Ensure we don't go below initialMessages
    if (cutIndex <= initialMessages) {
      // Couldn't find a safe cut point - skip pruning this time
      errorLogger.warn('Token Management', 'No safe cut point found, skipping pruning', {
        conversationLength: this.conversationHistory.length,
        initialMessages: initialMessages
      });
      return { pruned: false, reason: 'No safe cut point found' };
    }

    const prunedMessages = this.conversationHistory.slice(initialMessages, cutIndex);
    const recentMessages = this.conversationHistory.slice(cutIndex);

    // Create intelligent summary of pruned content
    const summary = this.createConversationSummary(prunedMessages);
    this.conversationSummary = summary;

    // Keep initial messages, add summary, keep recent messages
    this.conversationHistory = [
      ...this.conversationHistory.slice(0, initialMessages),
      {
        role: 'user',
        content: `[Previous conversation summary: ${summary}]`
      },
      ...recentMessages
    ];

    const afterCount = this.conversationHistory.length;
    const newTokens = this.calculateTotalTokens();
    const tokensSaved = currentTokens - newTokens;

    errorLogger.info('Token Management', 'Pruning completed', {
      messagesPruned: prunedMessages.length,
      beforeCount,
      afterCount,
      tokensSaved,
      newTotal: newTokens,
      newPercentage: Math.round((newTokens / this.MAX_TOKENS) * 100)
    });

    return {
      pruned: true,
      messagesPruned: prunedMessages.length,
      tokensSaved,
      newTotal: newTokens,
      summary
    };
  }

  /**
   * Create an intelligent summary of conversation messages
   * Preserves important context like locations searched, POIs found, and actions taken
   */
  createConversationSummary(messages) {
    const userQueries = [];
    const locations = new Set();
    const actions = new Set();
    const searches = []; // Track search results
    const toolsUsed = new Set();

    messages.forEach(msg => {
      // Process user messages
      if (msg.role === 'user' && typeof msg.content === 'string') {
        // Skip summary messages
        if (msg.content.startsWith('[Previous conversation summary:')) {
          return;
        }

        userQueries.push(msg.content);

        // Extract Japanese location names (カタカナ and 漢字)
        const japaneseLocations = msg.content.match(/[一-龠ぁ-ゔァ-ヴー々〆〤]{2,}/g);
        if (japaneseLocations) {
          japaneseLocations.forEach(loc => locations.add(loc));
        }

        // Extract English location names
        const englishLocations = msg.content.match(/(?:in|near|at|from|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g);
        if (englishLocations) {
          englishLocations.forEach(match => {
            const location = match.replace(/(?:in|near|at|from|to)\s+/, '');
            locations.add(location);
          });
        }

        // Extract actions
        if (msg.content.match(/探して|検索|見つけ|find|show|search|get/i)) actions.add('search');
        if (msg.content.match(/ルート|道順|route|direction|navigate|go/i)) actions.add('routing');
        if (msg.content.match(/隠す|消す|hide|clear|remove/i)) actions.add('manage');
        if (msg.content.match(/おすすめ|人気|recommend|popular/i)) actions.add('recommendations');
      }

      // Process assistant messages with tool use
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        msg.content.forEach(block => {
          if (block.type === 'tool_use') {
            toolsUsed.add(block.name);

            // Track searches
            if (block.name === 'search_pois_by_jis_code' || block.name === 'search_pois_by_location') {
              const location = block.input?.location || 'unknown';
              const category = block.input?.category || 'unknown';
              searches.push(`${category} in ${location}`);
            }
          }

          // Extract POI counts from text responses
          if (block.type === 'text') {
            const countMatch = block.text.match(/(\d+)件|found (\d+)|showing (\d+)/i);
            if (countMatch) {
              const count = countMatch[1] || countMatch[2] || countMatch[3];
              if (searches.length > 0) {
                searches[searches.length - 1] += ` (${count} POIs)`;
              }
            }
          }
        });
      }
    });

    // Build comprehensive summary
    const parts = [];

    if (userQueries.length > 0) {
      parts.push(`${userQueries.length} questions asked`);
    }

    if (locations.size > 0) {
      const locationList = Array.from(locations).slice(0, 5).join(', ');
      parts.push(`Locations: ${locationList}`);
    }

    if (searches.length > 0) {
      const searchSummary = searches.slice(0, 3).join('; ');
      parts.push(`Searches: ${searchSummary}`);
    }

    if (actions.size > 0) {
      parts.push(`Actions: ${Array.from(actions).join(', ')}`);
    }

    if (toolsUsed.size > 0) {
      parts.push(`Tools used: ${Array.from(toolsUsed).slice(0, 5).join(', ')}`);
    }

    const summary = parts.join(' | ');
    return summary || 'Previous conversation about Japan travel';
  }

  /**
   * Get token usage info using cached calculations
   */
  getTokenUsage() {
    // Use cached system prompt tokens
    if (this._cachedSystemPromptTokens === undefined || this._lastSystemPrompt !== this.systemPrompt) {
      this._cachedSystemPromptTokens = this.estimateTokens(this.systemPrompt);
      this._lastSystemPrompt = this.systemPrompt;
    }
    const systemPromptTokens = this._cachedSystemPromptTokens;

    // Use cached message tokens
    let conversationTokens = 0;
    this.conversationHistory.forEach(msg => {
      conversationTokens += this.getMessageTokens(msg);
    });

    // Estimate tools array size (not included in request but adds overhead)
    // Tools are sent with every request and can be 20-40k tokens
    const tools = [
      ...this.rurubuMCP.getToolsForClaude(),
      ...this.mapController.getToolsForClaude(),
      ...(this.app ? this.app.getSearchHistoryTools() : [])
    ];
    const toolsTokens = this.estimateTokens(JSON.stringify(tools));

    const total = systemPromptTokens + conversationTokens + toolsTokens;
    const percentage = (total / this.MAX_TOKENS) * 100;
    const remaining = this.MAX_TOKENS - total;

    return {
      total,
      systemPrompt: systemPromptTokens,
      conversationHistory: conversationTokens,
      tools: toolsTokens,
      max: this.MAX_TOKENS,
      percentage: Math.round(percentage),
      remaining,
      needsPruning: total >= this.PRUNE_THRESHOLD,
      showWarning: total >= this.WARNING_THRESHOLD
    };
  }
}
