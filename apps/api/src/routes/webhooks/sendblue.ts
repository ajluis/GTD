import type { FastifyPluginAsync } from 'fastify';
import type { SendblueWebhookPayload } from '@gtd/shared-types';
import {
  validateWebhookSignature,
  extractValidationHeaders,
  WebhookValidationError,
  createSendblueClient,
  fireTypingIndicator,
} from '@gtd/sendblue';
import { enqueueInboundMessage } from '@gtd/queue';
import type { Queue } from 'bullmq';
import type { MessageJobData } from '@gtd/queue';

// Create Sendblue client for typing indicators (graceful degradation if not configured)
let sendblueClient: ReturnType<typeof createSendblueClient> | null = null;
try {
  sendblueClient = createSendblueClient();
} catch {
  // Client not configured - typing indicators will be skipped
}

/**
 * Sendblue webhook configuration
 */
interface SendblueWebhookConfig {
  webhookSecret: string;
  messageQueue: Queue<MessageJobData>;
}

/**
 * Sendblue webhook routes
 *
 * Receives incoming SMS/iMessage messages from Sendblue.
 *
 * CRITICAL: Must respond quickly (< 3 seconds) or Sendblue will retry.
 * Heavy processing is done asynchronously via the message queue.
 */
export function createSendblueWebhook(config: SendblueWebhookConfig): FastifyPluginAsync {
  return async (fastify) => {
    // Configure raw body access for signature verification
    fastify.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (req, body, done) => {
        try {
          const json = JSON.parse(body as string);
          // Store raw body for signature verification
          (req as any).rawBody = body;
          done(null, json);
        } catch (err) {
          done(err as Error, undefined);
        }
      }
    );

    /**
     * POST /webhooks/sendblue
     *
     * Receives incoming SMS/iMessage from Sendblue
     */
    fastify.post<{ Body: SendblueWebhookPayload }>(
      '/',
      {
        schema: {
          body: {
            type: 'object',
            required: ['message_handle', 'from_number', 'content'],
            properties: {
              message_handle: { type: 'string' },
              from_number: { type: 'string' },
              to_number: { type: 'string' },
              content: { type: 'string' },
              is_outbound: { type: 'boolean' },
              service: { type: 'string' },
              was_downgraded: { type: 'boolean' },
              media_url: { type: 'string' },
              group_id: { type: 'string' },
              date_sent: { type: 'string' },
              status: { type: 'string' },
              opted_out: { type: 'boolean' },
              error_code: { type: 'string' },
              error_message: { type: 'string' },
            },
          },
        },
      },
      async (request, reply) => {
        const payload = request.body;
        const rawBody = (request as any).rawBody as string;

        // Log incoming message
        fastify.log.info(
          {
            from: payload.from_number,
            content: payload.content?.slice(0, 100),
            isOutbound: payload.is_outbound,
            messageHandle: payload.message_handle,
          },
          '📨 INBOUND WEBHOOK RECEIVED'
        );

        // 1. Validate webhook signature (skip if SKIP_WEBHOOK_VALIDATION is set)
        const skipValidation = process.env['SKIP_WEBHOOK_VALIDATION'] === 'true';

        if (!skipValidation) {
          try {
            const { signature, timestamp } = extractValidationHeaders(
              request.headers as Record<string, string | string[] | undefined>
            );

            validateWebhookSignature(
              rawBody,
              signature,
              timestamp,
              config.webhookSecret
            );
          } catch (error) {
            if (error instanceof WebhookValidationError) {
              fastify.log.warn({ error: error.message }, 'Webhook validation failed');
              return reply.status(401).send({
                error: 'Unauthorized',
                message: error.message,
              });
            }
            throw error;
          }
        } else {
          fastify.log.debug('Webhook signature validation skipped');
        }

        // 2. Skip outbound messages (our own replies)
        if (payload.is_outbound) {
          fastify.log.debug(
            { messageHandle: payload.message_handle },
            'Skipping outbound message'
          );
          return reply.status(200).send({ received: true, skipped: true });
        }

        // 3. Skip if user has opted out
        if (payload.opted_out) {
          fastify.log.info(
            { fromNumber: payload.from_number },
            'User has opted out'
          );
          return reply.status(200).send({ received: true, skipped: true });
        }

        // 4. Send typing indicator (fire-and-forget)
        if (sendblueClient) {
          fireTypingIndicator(sendblueClient, payload.from_number);
          fastify.log.debug(
            { toNumber: payload.from_number },
            'Typing indicator sent'
          );
        }

        // 5. Enqueue for async processing
        try {
          const jobId = await enqueueInboundMessage(config.messageQueue, {
            messageHandle: payload.message_handle,
            fromNumber: payload.from_number,
            content: payload.content,
            receivedAt: payload.date_sent || new Date().toISOString(),
          });

          fastify.log.info(
            {
              messageHandle: payload.message_handle,
              jobId,
              fromNumber: payload.from_number,
            },
            'Message enqueued for processing'
          );

          // 6. Return immediately (< 3 seconds)
          return reply.status(200).send({
            received: true,
            queued: true,
            messageId: payload.message_handle,
          });
        } catch (error) {
          const err = error as Error;
          fastify.log.error(
            {
              errorMessage: err.message,
              errorStack: err.stack,
              errorName: err.name,
            },
            'Failed to enqueue message'
          );

          // Still return 200 to prevent Sendblue retries
          // Message will be lost, but we log it for debugging
          return reply.status(200).send({
            received: true,
            queued: false,
            error: 'Failed to queue message',
          });
        }
      }
    );

    /**
     * GET /webhooks/sendblue
     *
     * Health check for webhook endpoint
     */
    fastify.get('/', async () => {
      return {
        status: 'ok',
        message: 'Sendblue webhook endpoint is active',
      };
    });
  };
}
