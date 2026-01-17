import { pgTable, uuid, text, timestamp, pgEnum, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import type { ClassificationResult } from '@gtd/shared-types';

/**
 * Message direction enum
 */
export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);

/**
 * Message delivery status enum
 */
export const messageStatusEnum = pgEnum('message_status', [
  'pending', // Queued for delivery
  'sent', // Sent to carrier (SMS only)
  'delivered', // Delivered to device (iMessage confirms this)
  'failed', // Delivery failed
  'received', // Inbound message received
]);

/**
 * Messages table
 * Stores all SMS/iMessage exchanges for history and debugging
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Reference to the user */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Content
    /** Message text content */
    content: text('content').notNull(),

    /** Direction: inbound (from user) or outbound (from GTD) */
    direction: messageDirectionEnum('direction').notNull(),

    /** Delivery status */
    status: messageStatusEnum('status').default('pending').notNull(),

    // Sendblue Reference
    /** Sendblue message_handle for tracking */
    sendblueMessageId: text('sendblue_message_id').unique(),

    // AI Classification (for inbound messages)
    /** Classification result from Gemini */
    classification: jsonb('classification').$type<ClassificationResult>(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** When message was actually sent */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** When delivery was confirmed */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_messages_user_id').on(table.userId),
    index('idx_messages_user_created').on(table.userId, table.createdAt),
    index('idx_messages_sendblue').on(table.sendblueMessageId),
    index('idx_messages_direction').on(table.userId, table.direction),
  ]
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
