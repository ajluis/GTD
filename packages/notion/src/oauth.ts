import type { NotionOAuthTokenResponse } from '@clarity/shared-types';

/**
 * Notion OAuth Configuration
 */
export interface NotionOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * OAuth Error
 */
export class NotionOAuthError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'NotionOAuthError';
  }
}

/**
 * Generate Notion OAuth authorization URL
 *
 * This URL should be sent to users to begin the OAuth flow.
 * When clicked, users will be taken to Notion to authorize Clarity.
 *
 * @param config - OAuth configuration
 * @param state - Optional state parameter for CSRF protection
 * @returns Authorization URL
 */
export function getAuthorizationUrl(
  config: NotionOAuthConfig,
  state?: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    owner: 'user',
    redirect_uri: config.redirectUri,
    ...(state && { state }),
  });

  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 *
 * Called after user completes Notion OAuth and is redirected back
 * with an authorization code.
 *
 * @param config - OAuth configuration
 * @param code - Authorization code from Notion callback
 * @returns Token response with access_token and workspace info
 */
export async function exchangeCodeForToken(
  config: NotionOAuthConfig,
  code: string
): Promise<NotionOAuthTokenResponse> {
  // Notion uses Basic auth with client_id:client_secret
  const authHeader = Buffer.from(
    `${config.clientId}:${config.clientSecret}`
  ).toString('base64');

  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${authHeader}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new NotionOAuthError(
      `Notion OAuth token exchange failed: ${(data as any).error ?? response.statusText}`,
      response.status,
      data
    );
  }

  return data as NotionOAuthTokenResponse;
}

/**
 * Create OAuth config from environment variables
 */
export function createOAuthConfig(): NotionOAuthConfig {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  const redirectUri = process.env.NOTION_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing Notion OAuth configuration. Required: NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, NOTION_REDIRECT_URI'
    );
  }

  return { clientId, clientSecret, redirectUri };
}
