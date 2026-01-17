import type { Job } from 'bullmq';
import type { OutboundMessageJobData } from '@gtd/queue';
import type { DbClient } from '@gtd/database';
import { messages } from '@gtd/database';
import { createSendblueClient, type SendblueClient } from '@gtd/sendblue';
import { splitMessage } from '@gtd/gtd';

/**
 * Outbound Message Processor
 *
 * Sends SMS messages via Sendblue:
 * 1. Split long messages if needed
 * 2. Send via Sendblue API
 * 3. Store in database
 */
export function createOutboundProcessor(db: DbClient, sendblue?: SendblueClient) {
  const client = sendblue ?? createSendblueClient();

  return async (job: Job<OutboundMessageJobData>) => {
    const { userId, toNumber, content, inReplyTo } = job.data;

    console.log('═'.repeat(60));
    console.log(`📤 OUTBOUND MESSAGE SENDING`);
    console.log(`   To: ${toNumber}`);
    console.log(`   Content: "${content}"`);
    console.log('═'.repeat(60));

    // Split long messages
    const parts = splitMessage(content);

    const results: Array<{ messageHandle: string; part: number }> = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;

      try {
        // Send via Sendblue
        const response = await client.sendMessage(toNumber, part);

        console.log(
          `[Outbound] Sent part ${i + 1}/${parts.length}: ${response.message_handle}`
        );

        // Store in database
        await db.insert(messages).values({
          userId,
          content: part,
          direction: 'outbound',
          status: 'sent',
          sendblueMessageId: response.message_handle,
        });

        results.push({
          messageHandle: response.message_handle,
          part: i + 1,
        });

        // Small delay between multi-part messages to ensure order
        if (parts.length > 1 && i < parts.length - 1) {
          await sleep(500);
        }
      } catch (error) {
        console.error(`[Outbound] Failed to send part ${i + 1}:`, error);

        // Store failed message
        await db.insert(messages).values({
          userId,
          content: part,
          direction: 'outbound',
          status: 'failed',
        });

        // Re-throw to trigger retry
        throw error;
      }
    }

    return {
      success: true,
      parts: parts.length,
      results,
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
