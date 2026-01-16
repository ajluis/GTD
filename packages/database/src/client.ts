import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/**
 * Create a database client instance
 *
 * @param connectionString - PostgreSQL connection URL
 * @returns Drizzle database client with schema
 */
export function createDbClient(connectionString: string) {
  const queryClient = postgres(connectionString, {
    max: 20, // Connection pool size
    idle_timeout: 30, // Close idle connections after 30s
    connect_timeout: 10, // Connection timeout
  });

  return drizzle(queryClient, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;
