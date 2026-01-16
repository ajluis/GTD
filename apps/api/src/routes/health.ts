import type { FastifyPluginAsync } from 'fastify';

/**
 * Health check routes
 *
 * - /health/live - Liveness probe (is the server running?)
 * - /health/ready - Readiness probe (is the server ready to accept traffic?)
 */
export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // Liveness probe - just checks if server is responding
  fastify.get('/live', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness probe - checks if all dependencies are available
  fastify.get('/ready', async (request, reply) => {
    const checks: Record<string, boolean> = {
      server: true,
    };

    // Check database connection
    try {
      // Database check would go here
      // await fastify.db.execute(sql`SELECT 1`);
      checks['database'] = true;
    } catch {
      checks['database'] = false;
    }

    // Check Redis connection
    try {
      // Redis check would go here
      // await fastify.redis.ping();
      checks['redis'] = true;
    } catch {
      checks['redis'] = false;
    }

    const allHealthy = Object.values(checks).every(Boolean);

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    });
  });
};
