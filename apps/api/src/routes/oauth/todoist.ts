import type { FastifyPluginAsync } from 'fastify';
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  createOAuthConfig,
  getUserInfo,
  TodoistOAuthError,
} from '@gtd/todoist';
import { users } from '@gtd/database';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@gtd/database';

/**
 * Todoist OAuth configuration
 */
interface TodoistOAuthRoutesConfig {
  db: DbClient;
  appUrl: string;
}

/**
 * Todoist OAuth routes
 *
 * Handles the OAuth flow for connecting user's Todoist account.
 * This replaces Notion as the primary task storage backend.
 */
export function createTodoistOAuthRoutes(config: TodoistOAuthRoutesConfig): FastifyPluginAsync {
  const oauthConfig = createOAuthConfig();

  return async (fastify) => {
    /**
     * GET /oauth/todoist/authorize
     *
     * Initiates OAuth flow. Called when user clicks auth link in SMS.
     * Expects ?phone= query param to identify the user.
     */
    fastify.get<{ Querystring: { phone?: string } }>(
      '/authorize',
      async (request, reply) => {
        const { phone } = request.query;

        if (!phone) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Missing phone parameter',
          });
        }

        // Use phone number as state for identifying user on callback
        // In production, you'd want to encrypt/sign this
        const state = Buffer.from(phone).toString('base64url');

        const authUrl = getAuthorizationUrl(oauthConfig, state);

        // Redirect to Todoist authorization page
        return reply.redirect(authUrl);
      }
    );

    /**
     * GET /oauth/todoist/callback
     *
     * OAuth callback from Todoist after user authorizes.
     */
    fastify.get<{
      Querystring: { code?: string; state?: string; error?: string };
    }>('/callback', async (request, reply) => {
      const { code, state, error } = request.query;

      // Handle OAuth errors
      if (error) {
        fastify.log.error({ error }, 'Todoist OAuth error');
        return reply.status(400).send({
          error: 'OAuth Error',
          message: 'Failed to authorize with Todoist. Please try again.',
        });
      }

      if (!code || !state) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Missing code or state parameter',
        });
      }

      // Decode phone number from state
      let phoneNumber: string;
      try {
        phoneNumber = Buffer.from(state, 'base64url').toString('utf-8');
      } catch {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid state parameter',
        });
      }

      try {
        // 1. Exchange code for access token
        const tokenResponse = await exchangeCodeForToken(oauthConfig, code);

        fastify.log.info('Todoist OAuth token exchange successful');

        // 2. Get user info from Todoist
        const userInfo = await getUserInfo(tokenResponse.access_token);

        fastify.log.info(
          {
            todoistUserId: userInfo.id,
            todoistEmail: userInfo.email,
            todoistTimezone: userInfo.timezone,
          },
          'Todoist user info retrieved'
        );

        // 3. Update user record
        await config.db
          .update(users)
          .set({
            todoistAccessToken: tokenResponse.access_token,
            todoistUserId: userInfo.id,
            // Optionally update timezone from Todoist if user hasn't set one
            // timezone: userInfo.timezone,
            status: 'active',
            onboardingStep: 'complete',
            updatedAt: new Date(),
          })
          .where(eq(users.phoneNumber, phoneNumber));

        // 4. Show success page
        return reply.type('text/html').send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Connected! - GTD</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #e44332 0%, #db4c3f 100%);
                color: white;
                text-align: center;
                padding: 20px;
              }
              .card {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                padding: 40px;
                border-radius: 20px;
                max-width: 400px;
              }
              h1 { font-size: 48px; margin: 0 0 20px; }
              p { font-size: 18px; opacity: 0.9; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>✅</h1>
              <h2>Connected to Todoist!</h2>
              <p>Hi ${userInfo.full_name}! Your Todoist is now linked to GTD.</p>
              <p>You can close this page and go back to SMS.</p>
            </div>
          </body>
          </html>
        `);
      } catch (error) {
        fastify.log.error({ error }, 'Todoist OAuth callback failed');

        if (error instanceof TodoistOAuthError) {
          return reply.status(400).send({
            error: 'OAuth Error',
            message: 'Failed to complete Todoist authorization. Please try again.',
          });
        }

        throw error;
      }
    });
  };
}
