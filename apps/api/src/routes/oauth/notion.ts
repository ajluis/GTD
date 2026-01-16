import type { FastifyPluginAsync } from 'fastify';
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  createOAuthConfig,
  NotionOAuthError,
  createNotionClient,
  setupNotionDatabases,
} from '@clarity/notion';
import { users } from '@clarity/database';
import { eq } from 'drizzle-orm';
import type { DbClient } from '@clarity/database';

/**
 * Notion OAuth configuration
 */
interface NotionOAuthRoutesConfig {
  db: DbClient;
  appUrl: string;
}

/**
 * Notion OAuth routes
 *
 * Handles the OAuth flow for connecting user's Notion workspace.
 */
export function createNotionOAuthRoutes(config: NotionOAuthRoutesConfig): FastifyPluginAsync {
  const oauthConfig = createOAuthConfig();

  return async (fastify) => {
    /**
     * GET /oauth/notion/authorize
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

        // Redirect to Notion authorization page
        return reply.redirect(authUrl);
      }
    );

    /**
     * GET /oauth/notion/callback
     *
     * OAuth callback from Notion after user authorizes.
     */
    fastify.get<{
      Querystring: { code?: string; state?: string; error?: string };
    }>('/callback', async (request, reply) => {
      const { code, state, error } = request.query;

      // Handle OAuth errors
      if (error) {
        fastify.log.error({ error }, 'Notion OAuth error');
        return reply.status(400).send({
          error: 'OAuth Error',
          message: 'Failed to authorize with Notion. Please try again.',
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

        fastify.log.info(
          {
            workspaceId: tokenResponse.workspace_id,
            workspaceName: tokenResponse.workspace_name,
          },
          'Notion OAuth successful'
        );

        // 2. Set up Notion databases
        const notion = createNotionClient(tokenResponse.access_token);
        const dbSetup = await setupNotionDatabases(notion);

        fastify.log.info(
          {
            tasksDbId: dbSetup.tasksDbId,
            peopleDbId: dbSetup.peopleDbId,
          },
          'Notion databases created'
        );

        // 3. Update user record
        await config.db
          .update(users)
          .set({
            notionAccessToken: tokenResponse.access_token,
            notionWorkspaceId: tokenResponse.workspace_id,
            notionWorkspaceName: tokenResponse.workspace_name,
            notionBotId: tokenResponse.bot_id,
            notionTasksDatabaseId: dbSetup.tasksDbId,
            notionPeopleDatabaseId: dbSetup.peopleDbId,
            status: 'active',
            onboardingStep: 'complete',
            updatedAt: new Date(),
          })
          .where(eq(users.phoneNumber, phoneNumber));

        // 4. Show success page
        // In production, you'd want a nicer HTML page
        return reply.type('text/html').send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Connected! - Clarity</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
              <h1>🎉</h1>
              <h2>Connected to Notion!</h2>
              <p>Your workspace "${tokenResponse.workspace_name}" is now linked to Clarity.</p>
              <p>You can close this page and go back to SMS.</p>
            </div>
          </body>
          </html>
        `);
      } catch (error) {
        fastify.log.error({ error }, 'Notion OAuth callback failed');

        if (error instanceof NotionOAuthError) {
          return reply.status(400).send({
            error: 'OAuth Error',
            message: 'Failed to complete Notion authorization. Please try again.',
          });
        }

        throw error;
      }
    });
  };
}
