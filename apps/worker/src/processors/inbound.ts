import type { Job } from 'bullmq';
import type { InboundMessageJobData, MessageJobData } from '@clarity/queue';
import { enqueueClassification, enqueueOutboundMessage } from '@clarity/queue';
import type { Queue } from 'bullmq';
import type { DbClient } from '@clarity/database';
import { users, messages } from '@clarity/database';
import { eq } from 'drizzle-orm';
import { formatWelcome } from '@clarity/gtd';

/**
 * Inbound Message Processor
 *
 * Handles incoming SMS messages:
 * 1. Find or create user by phone number
 * 2. Store message in database
 * 3. Check user status (onboarding vs active)
 * 4. Route to appropriate handler
 */
export function createInboundProcessor(
  db: DbClient,
  messageQueue: Queue<MessageJobData>,
  appUrl: string
) {
  return async (job: Job<InboundMessageJobData>) => {
    const { fromNumber, content, messageHandle, receivedAt } = job.data;

    console.log('═'.repeat(60));
    console.log(`📨 INBOUND MESSAGE RECEIVED`);
    console.log(`   From: ${fromNumber}`);
    console.log(`   Content: "${content}"`);
    console.log(`   Handle: ${messageHandle}`);
    console.log('═'.repeat(60));

    // 1. Find or create user
    let user = await db.query.users.findFirst({
      where: eq(users.phoneNumber, fromNumber),
    });

    if (!user) {
      // Create new user
      const [newUser] = await db
        .insert(users)
        .values({
          phoneNumber: fromNumber,
          status: 'onboarding',
          onboardingStep: 'welcome',
        })
        .returning();

      user = newUser!;
      console.log(`[Inbound] Created new user: ${user.id}`);
    }

    // 2. Store message
    const [message] = await db
      .insert(messages)
      .values({
        userId: user.id,
        content,
        direction: 'inbound',
        status: 'received',
        sendblueMessageId: messageHandle,
      })
      .returning();

    // 3. Update user's last message time
    await db
      .update(users)
      .set({
        lastMessageAt: new Date(receivedAt),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // 4. Route based on user status
    if (user.status === 'onboarding') {
      // Handle onboarding flow
      await handleOnboarding(user, content, messageQueue, appUrl);
    } else if (user.status === 'active') {
      // Classify message and process
      await enqueueClassification(messageQueue, {
        userId: user.id,
        messageId: message!.id,
        content,
      });
    } else {
      // User is paused - send reactivation message
      await enqueueOutboundMessage(messageQueue, {
        userId: user.id,
        toNumber: fromNumber,
        content: "Your Clarity account is paused. Reply 'activate' to resume.",
      });
    }

    return { success: true, userId: user.id, messageId: message!.id };
  };
}

/**
 * Handle onboarding flow based on current step
 */
async function handleOnboarding(
  user: { id: string; phoneNumber: string; onboardingStep: string | null },
  content: string,
  messageQueue: Queue<MessageJobData>,
  appUrl: string
) {
  const step = user.onboardingStep ?? 'welcome';

  switch (step) {
    case 'welcome':
      // Send welcome message with OAuth link
      const oauthUrl = `${appUrl}/oauth/notion/authorize?phone=${encodeURIComponent(user.phoneNumber)}`;
      await enqueueOutboundMessage(messageQueue, {
        userId: user.id,
        toNumber: user.phoneNumber,
        content: formatWelcome(oauthUrl),
      });
      break;

    case 'oauth_pending':
      // User messaged while waiting for OAuth
      await enqueueOutboundMessage(messageQueue, {
        userId: user.id,
        toNumber: user.phoneNumber,
        content:
          "Please complete the Notion connection first by clicking the link I sent. If you need a new link, reply 'link'.",
      });
      break;

    case 'complete':
      // Onboarding complete but status not updated - fix and process
      console.log(`[Inbound] Onboarding complete but status is still onboarding for user ${user.id}`);
      // This case shouldn't normally happen
      break;

    default:
      // Unknown step - restart onboarding
      const restartUrl = `${appUrl}/oauth/notion/authorize?phone=${encodeURIComponent(user.phoneNumber)}`;
      await enqueueOutboundMessage(messageQueue, {
        userId: user.id,
        toNumber: user.phoneNumber,
        content: formatWelcome(restartUrl),
      });
  }
}
