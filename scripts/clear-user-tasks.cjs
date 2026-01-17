#!/usr/bin/env node
/**
 * Clear tasks for a user by phone number
 * Run with: railway run node scripts/clear-user-tasks.cjs [phone_number]
 */

const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  const phoneNumber = process.argv[2] || '+19148068971';

  console.log('Looking up user:', phoneNumber);

  // Get user ID
  const users = await sql`
    SELECT id FROM users WHERE phone_number = ${phoneNumber}
  `;

  if (users.length === 0) {
    console.log('User not found for phone:', phoneNumber);
    await sql.end();
    return;
  }

  const userId = users[0].id;
  console.log('User ID:', userId);

  // Delete tasks
  const deletedTasks = await sql`
    DELETE FROM tasks WHERE user_id = ${userId} RETURNING id
  `;
  console.log('Deleted', deletedTasks.length, 'tasks');

  // Delete conversation states
  const deletedStates = await sql`
    DELETE FROM conversation_states WHERE user_id = ${userId} RETURNING id
  `;
  console.log('Deleted', deletedStates.length, 'conversation states');

  // Delete people (optional - uncomment if needed)
  // const deletedPeople = await sql`
  //   DELETE FROM people WHERE user_id = ${userId} RETURNING id
  // `;
  // console.log('Deleted', deletedPeople.length, 'people');

  await sql.end();
  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
