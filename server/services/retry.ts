/**
 * Retry utility for Google Cloud API calls with exponential backoff
 * Classifies errors as transient (can retry) or permanent (should fail)
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterFactor?: number; // 0-1, fraction of delay to add as random jitter
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Determines if an error is transient and should be retried
 */
function isTransientError(error: any): boolean {
  if (!error) return false;

  // Google API error codes that are transient
  const transientCodes = [
    'DEADLINE_EXCEEDED', // Timeout
    'RESOURCE_EXHAUSTED', // Quota or rate limit
    'UNAVAILABLE', // Service temporarily unavailable
    'INTERNAL', // Internal server error
    'SERVICE_UNAVAILABLE',
    408, // Request Timeout
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
  ];

  // Check error code
  const errorCode = error.code || error.status || error.message;
  if (transientCodes.includes(errorCode)) {
    return true;
  }

  // Check error message for transient patterns
  const message = (error.message || '').toLowerCase();
  if (
    message.includes('timeout') ||
    message.includes('deadline') ||
    message.includes('unavailable') ||
    message.includes('resource exhausted') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  ) {
    return true;
  }

  // Network-related errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitterFactor: number
): number {
  // Exponential backoff: initialDelay * (multiplier ^ attempt)
  const exponentialDelay = Math.min(
    initialDelayMs * Math.pow(backoffMultiplier, attempt),
    maxDelayMs
  );

  // Add jitter: random value between 0 and jitterFactor * delay
  const jitter = Math.random() * jitterFactor * exponentialDelay;

  return exponentialDelay + jitter;
}

/**
 * Wraps an async function with retry logic
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  operationName: string,
  options?: RetryOptions
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // Log the error
      const isTransient = isTransientError(error);
      const errorType = isTransient ? 'transient' : 'permanent';
      console.error(
        `[Retry] ${operationName} failed (${errorType}, attempt ${attempt + 1}/${config.maxRetries + 1}):`,
        error instanceof Error ? error.message : error
      );

      // Don't retry permanent errors
      if (!isTransient) {
        console.error(`[Retry] ${operationName} failed with permanent error, not retrying`);
        throw error;
      }

      // Don't retry if we've exhausted retries
      if (attempt >= config.maxRetries) {
        console.error(`[Retry] ${operationName} exhausted max retries (${config.maxRetries})`);
        throw error;
      }

      // Calculate delay and wait
      const delay = calculateDelay(
        attempt,
        config.initialDelayMs,
        config.maxDelayMs,
        config.backoffMultiplier,
        config.jitterFactor
      );

      console.log(`[Retry] ${operationName} retrying in ${Math.round(delay)}ms (attempt ${attempt + 2}/${config.maxRetries + 1})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but just in case
  throw lastError || new Error(`${operationName} failed after ${config.maxRetries} retries`);
}

/**
 * Creates a retry-wrapped version of an async function
 */
export function retryable<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  operationName: string,
  options?: RetryOptions
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    return withRetry(
      (attempt) => fn(...args),
      operationName,
      options
    );
  };
}
