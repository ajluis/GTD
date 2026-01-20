/**
 * Todoist OAuth 2.0 Flow
 *
 * Handles the OAuth flow for connecting user's Todoist account.
 * Reference: https://developer.todoist.com/guides/#oauth
 */

/**
 * Todoist OAuth Configuration
 */
export interface TodoistOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * OAuth Token Response from Todoist
 */
export interface TodoistOAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
}

/**
 * Todoist User Info from /sync/v9/user
 */
export interface TodoistUserInfo {
  id: string;
  email: string;
  full_name: string;
  inbox_project_id: string;
  timezone: string;
}

/**
 * OAuth Error
 */
export class TodoistOAuthError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'TodoistOAuthError';
  }
}

/**
 * Generate Todoist OAuth authorization URL
 *
 * This URL should be sent to users to begin the OAuth flow.
 * When clicked, users will be taken to Todoist to authorize GTD.
 *
 * @param config - OAuth configuration
 * @param state - Optional state parameter for CSRF protection (we encode phone number here)
 * @returns Authorization URL
 */
export function getAuthorizationUrl(
  config: TodoistOAuthConfig,
  state?: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: 'data:read_write,data:delete',
    state: state ?? '',
  });

  return `https://todoist.com/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 *
 * Called after user completes Todoist OAuth and is redirected back
 * with an authorization code.
 *
 * @param config - OAuth configuration
 * @param code - Authorization code from Todoist callback
 * @returns Token response with access_token
 */
export async function exchangeCodeForToken(
  config: TodoistOAuthConfig,
  code: string
): Promise<TodoistOAuthTokenResponse> {
  const response = await fetch('https://todoist.com/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new TodoistOAuthError(
      `Todoist OAuth token exchange failed: ${(data as any).error ?? response.statusText}`,
      response.status,
      data
    );
  }

  return data as TodoistOAuthTokenResponse;
}

/**
 * Get user info from Todoist
 *
 * Called after obtaining access token to get user details
 * including their inbox project ID and timezone.
 */
export async function getUserInfo(accessToken: string): Promise<TodoistUserInfo> {
  // Use sync API to get full user info including inbox_project_id
  const response = await fetch('https://api.todoist.com/sync/v9/sync', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      sync_token: '*',
      resource_types: '["user"]',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new TodoistOAuthError(
      `Failed to get Todoist user info: ${errorText}`,
      response.status
    );
  }

  const data = await response.json();
  const user = data.user;

  return {
    id: String(user.id),
    email: user.email,
    full_name: user.full_name,
    inbox_project_id: String(user.inbox_project_id),
    timezone: user.tz_info?.timezone ?? 'UTC',
  };
}

/**
 * Create OAuth config from environment variables
 */
export function createOAuthConfig(): TodoistOAuthConfig {
  const clientId = process.env['TODOIST_CLIENT_ID'];
  const clientSecret = process.env['TODOIST_CLIENT_SECRET'];
  const redirectUri = process.env['TODOIST_REDIRECT_URI'];

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing Todoist OAuth configuration. Required: TODOIST_CLIENT_ID, TODOIST_CLIENT_SECRET, TODOIST_REDIRECT_URI'
    );
  }

  return { clientId, clientSecret, redirectUri };
}
