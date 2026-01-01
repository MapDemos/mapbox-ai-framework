/**
 * Error Logger Module
 * Provides consistent error logging and tracking across the application
 */

export class ErrorLogger {
  constructor() {
    this.errors = [];
    this.maxErrors = 50; // Keep last 50 errors in memory
    this.errorCounts = new Map(); // Track error frequency
  }

  /**
   * Log an error with context and additional data
   * @param {string} context - Where the error occurred (e.g., 'Claude API', 'Map Controller')
   * @param {Error|string} error - Error object or message
   * @param {Object} additionalData - Extra context data
   * @returns {Object} Structured error info
   */
  log(context, error, additionalData = {}) {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      context: context,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: error instanceof Error ? error.constructor.name : 'String',
      ...additionalData
    };

    // Store error
    this.errors.push(errorInfo);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift(); // Remove oldest error
    }

    // Track error frequency
    const errorKey = `${context}:${errorInfo.message}`;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);

    // Log to console with structured format
    console.error(`[ERROR] ${context}:`, {
      message: errorInfo.message,
      type: errorInfo.type,
      stack: errorInfo.stack,
      ...additionalData
    });

    return errorInfo;
  }

  /**
   * Log a warning
   * @param {string} context - Where the warning occurred
   * @param {string} message - Warning message
   * @param {Object} additionalData - Extra context data
   */
  warn(context, message, additionalData = {}) {
    console.warn(`[WARN] ${context}:`, message, additionalData);
  }

  /**
   * Log an info message
   * @param {string} context - Where the info message originated
   * @param {string} message - Info message
   * @param {Object} additionalData - Extra context data
   */
  info(context, message, additionalData = {}) {
  }

  /**
   * Get recent errors
   * @param {number} count - Number of recent errors to retrieve
   * @returns {Array} Recent error objects
   */
  getRecentErrors(count = 10) {
    return this.errors.slice(-count);
  }

  /**
   * Get error statistics
   * @returns {Object} Error frequency and counts
   */
  getErrorStats() {
    const sortedErrors = Array.from(this.errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 most frequent errors

    return {
      totalErrors: this.errors.length,
      uniqueErrors: this.errorCounts.size,
      mostFrequent: sortedErrors.map(([key, count]) => ({ error: key, count }))
    };
  }

  /**
   * Clear error history
   */
  clear() {
    this.errors = [];
    this.errorCounts.clear();
  }

  /**
   * Export errors for debugging or reporting
   * @returns {string} JSON string of all errors
   */
  exportErrors() {
    return JSON.stringify({
      errors: this.errors,
      stats: this.getErrorStats(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Check if an error type is occurring frequently
   * @param {string} context - Error context to check
   * @param {string} message - Error message to check
   * @param {number} threshold - Frequency threshold (default: 3)
   * @returns {boolean} True if error is frequent
   */
  isFrequentError(context, message, threshold = 3) {
    const errorKey = `${context}:${message}`;
    return (this.errorCounts.get(errorKey) || 0) >= threshold;
  }
}

// Create singleton instance
export const errorLogger = new ErrorLogger();

// Export convenience methods for quick access
export const logError = (context, error, data) => errorLogger.log(context, error, data);
export const logWarn = (context, message, data) => errorLogger.warn(context, message, data);
export const logInfo = (context, message, data) => errorLogger.info(context, message, data);
