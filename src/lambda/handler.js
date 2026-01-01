/**
 * AWS Lambda handler for AI API proxy
 * Supports both Claude and Gemini APIs
 * Handles CORS and forwards requests to appropriate AI provider
 * Supports streaming responses for better UX
 *
 * Security Features:
 * - Origin validation (set ALLOWED_ORIGINS env var)
 * - Referer header validation
 * - CORS configuration via Lambda Function URL settings
 *
 * Recommended Environment Variables:
 * - ALLOWED_ORIGINS: Comma-separated list of allowed origins (e.g., "https://example.com,https://www.example.com")
 * - CLAUDE_API_KEY: Your Claude API key
 * - GEMINI_API_KEY: Your Gemini API key (optional)
 * - DEFAULT_AI_PROVIDER: 'claude' or 'gemini'
 *
 * Additional Security Recommendations:
 * - Enable AWS WAF for DDoS protection
 * - Configure Lambda throttling limits
 * - Enable CloudWatch logging for monitoring
 * - Use AWS Secrets Manager for API keys
 * - Set up API Gateway with rate limiting if needed
 */

import { pipeline } from 'stream/promises';

// Simple in-memory rate limiter (resets on cold start)
// For production: Use DynamoDB or ElastiCache for persistent rate limiting
const rateLimitStore = new Map(); // Map<IP, { count, resetTime }>
const RATE_LIMIT_WINDOW = 60000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'); // 100 requests per minute per IP

/**
 * Check if request exceeds rate limit
 * @param {string} identifier - IP address or identifier
 * @returns {Object} { allowed: boolean, remaining: number, resetTime: number }
 */
function checkRateLimit(identifier) {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);

  // No record or window expired - create new
  if (!record || now >= record.resetTime) {
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetTime: now + RATE_LIMIT_WINDOW
    };
  }

  // Within window - check count
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime
    };
  }

  // Increment count
  record.count++;
  rateLimitStore.set(identifier, record);

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - record.count,
    resetTime: record.resetTime
  };
}

export const handler = async (event) => {
  // Note: CORS is handled by Lambda Function URL configuration
  // No need to add CORS headers here to avoid duplicates

  try {
    // Rate Limiting: Check per-IP rate limit
    const sourceIp = event.requestContext?.http?.sourceIp ||
                     event.requestContext?.identity?.sourceIp ||
                     'unknown';

    const rateLimitResult = checkRateLimit(sourceIp);

    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000);
      console.warn('[Rate Limit] Request blocked from IP:', sourceIp);
      return {
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': RATE_LIMIT_MAX_REQUESTS.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': rateLimitResult.resetTime.toString()
        },
        body: JSON.stringify({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
          retryAfter
        })
      };
    }

    // CSRF Protection: Validate Origin header
    const origin = event.headers.origin || event.headers.Origin;
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim());

    // If ALLOWED_ORIGINS is configured, enforce it
    if (allowedOrigins.length > 0 && allowedOrigins[0] !== '') {
      if (!origin || !allowedOrigins.includes(origin)) {
        console.warn('[Security] Request blocked - invalid origin:', origin);
        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Forbidden: Invalid origin' })
        };
      }
    }

    // Validate Referer header as additional CSRF protection
    const referer = event.headers.referer || event.headers.Referer;
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        // If origin is set, referer should match
        if (origin) {
          const originUrl = new URL(origin);
          if (refererUrl.hostname !== originUrl.hostname) {
            console.warn('[Security] Request blocked - referer/origin mismatch');
            return {
              statusCode: 403,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ error: 'Forbidden: Invalid referer' })
            };
          }
        }
      } catch (error) {
        console.warn('[Security] Invalid referer URL:', referer);
      }
    }

    // Parse request body
    const requestBody = JSON.parse(event.body);

    // Determine AI provider from header or request body
    const aiProvider = event.headers['x-ai-provider'] ||
                       requestBody.provider ||
                       process.env.DEFAULT_AI_PROVIDER ||
                       'claude';

    // Check if streaming is requested
    if (requestBody.stream === true) {
      return await handleStreamingRequest(aiProvider, requestBody);
    }

    if (aiProvider === 'gemini') {
      return await handleGemini(requestBody);
    } else {
      return await handleClaude(requestBody);
    }

  } catch (error) {
    console.error('[Lambda] Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

/**
 * Handle streaming requests
 */
async function handleStreamingRequest(aiProvider, requestBody) {
  if (aiProvider === 'claude') {
    return await handleClaudeStreaming(requestBody);
  } else {
    // Fallback to non-streaming for other providers
    return await handleGemini(requestBody);
  }
}

/**
 * Handle Claude streaming API requests
 */
async function handleClaudeStreaming(requestBody) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY not configured');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error('[Claude] API error:', response.status, errorData);
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: errorData })
    };
  }

  // Read the streaming response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunks = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            chunks.push(parsed);
          } catch (e) {
            console.error('[Claude] Failed to parse chunk:', e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Return accumulated chunks for Lambda (not true streaming, but better than nothing)
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ chunks })
  };
}

/**
 * Handle Claude API requests (non-streaming)
 */
async function handleClaude(requestBody) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY not configured');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('[Claude] API error:', response.status, data);
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: data })
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  };
}

/**
 * Handle Gemini API requests
 */
async function handleGemini(requestBody) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  // Extract model from request or use default
  const model = requestBody.model || 'gemini-2.0-flash-exp';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('[Gemini] API error:', response.status, data);
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: data })
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  };
}
