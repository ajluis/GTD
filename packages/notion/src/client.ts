import { Client } from '@notionhq/client';

/**
 * Create a Notion client with user's access token
 *
 * @param accessToken - User's Notion OAuth access token
 * @returns Configured Notion client
 */
export function createNotionClient(accessToken: string): Client {
  return new Client({
    auth: accessToken,
  });
}

export type NotionClient = Client;
