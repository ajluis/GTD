import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';

/**
 * Gemini AI Client Configuration
 */
export interface GeminiClientConfig {
  /** Google AI API key */
  apiKey: string;
  /** Model to use (default: gemini-3-flash-preview) */
  model?: string;
}

/**
 * Gemini AI Client
 *
 * Wrapper around Google's Generative AI SDK configured for
 * GTD task classification with JSON output.
 */
export class GeminiClient {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  private modelName: string;

  constructor(config: GeminiClientConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.modelName = config.model ?? 'gemini-3-flash-preview';

    this.model = this.client.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent classification
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json', // Force JSON output
      },
    });
  }

  /**
   * Generate content with the configured model
   *
   * Includes automatic retry with exponential backoff for transient errors
   * (503 Service Unavailable, 429 Rate Limited).
   *
   * @param prompt - The prompt to send to Gemini
   * @param systemInstruction - Optional system instruction (prepended to prompt)
   * @returns Generated text response
   */
  async generate(prompt: string, systemInstruction?: string): Promise<string> {
    // Combine system instruction with user prompt if provided
    const fullPrompt = systemInstruction
      ? `${systemInstruction}\n\n${prompt}`
      : prompt;

    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.model.generateContent(fullPrompt);
        return result.response.text();
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable (503 or 429)
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(
          `[GeminiClient] Retrying after ${delay}ms (attempt ${attempt}/${maxRetries})`
        );
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is retryable (transient server error)
   */
  private isRetryableError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status;
      return status === 503 || status === 429;
    }
    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate and parse JSON response
   *
   * @param prompt - The prompt expecting JSON response
   * @param systemInstruction - Optional system instruction
   * @returns Parsed JSON object
   * @throws Error if response is not valid JSON
   */
  async generateJSON<T>(prompt: string, systemInstruction?: string): Promise<T> {
    const text = await this.generate(prompt, systemInstruction);

    try {
      // Clean potential markdown code blocks
      const cleanedText = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      return JSON.parse(cleanedText) as T;
    } catch (error) {
      throw new Error(`Failed to parse Gemini response as JSON: ${text}`);
    }
  }

  /**
   * Get the model name being used
   */
  getModelName(): string {
    return this.modelName;
  }
}

/**
 * Create Gemini client from environment variables
 */
export function createGeminiClient(): GeminiClient {
  const apiKey = process.env['GOOGLE_AI_API_KEY'];

  if (!apiKey) {
    throw new Error('Missing GOOGLE_AI_API_KEY environment variable');
  }

  return new GeminiClient({ apiKey });
}
