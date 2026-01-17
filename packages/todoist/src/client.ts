/**
 * Todoist API Client
 *
 * Simple REST client for Todoist Sync API
 */

export class TodoistClient {
  private apiToken: string;
  private baseUrl = 'https://api.todoist.com/rest/v2';

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  /**
   * Make authenticated request to Todoist API
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Todoist API error (${response.status}): ${errorText}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * DELETE request
   */
  async delete(endpoint: string): Promise<void> {
    await this.request(endpoint, { method: 'DELETE' });
  }
}

/**
 * Create Todoist client from environment variable
 */
export function createTodoistClient(apiToken?: string): TodoistClient {
  const token = apiToken ?? process.env['TODOIST_API_TOKEN'];

  if (!token) {
    throw new Error('Missing TODOIST_API_TOKEN environment variable');
  }

  return new TodoistClient(token);
}
