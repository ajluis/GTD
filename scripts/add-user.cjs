#!/usr/bin/env node
/**
 * Add User Script
 *
 * Creates a new user or updates an existing user's Todoist token.
 * Uses upsert semantics - if phone number exists, updates the token.
 *
 * Usage:
 *   node scripts/add-user.cjs <phone-number> <todoist-token>
 *
 * With Railway:
 *   railway run node scripts/add-user.cjs +19148152449 <token>
 */

const postgres = require('postgres');

async function main() {
  const [phoneNumber, todoistToken] = process.argv.slice(2);

  // Validate arguments
  if (!phoneNumber || !todoistToken) {
    console.error('Usage: node scripts/add-user.cjs <phone-number> <todoist-token>');
    console.error('');
    console.error('Arguments:');
    console.error('  phone-number   Phone number in E.164 format (e.g., +19148152449)');
    console.error('  todoist-token  Todoist API access token');
    process.exit(1);
  }

  // Validate E.164 format
  if (!phoneNumber.match(/^\+[1-9]\d{1,14}$/)) {
    console.error(`❌ Invalid phone number format: ${phoneNumber}`);
    console.error('   Expected E.164 format (e.g., +19148152449)');
    process.exit(1);
  }

  // Get database URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    console.error('   Set it in .env or pass it directly');
    process.exit(1);
  }

  console.log(`📱 Adding user: ${phoneNumber}`);

  const sql = postgres(databaseUrl);

  try {
    // Check if user already exists
    const existingUsers = await sql`
      SELECT id, status FROM users WHERE phone_number = ${phoneNumber}
    `;

    if (existingUsers.length > 0) {
      // Update existing user
      const existingUser = existingUsers[0];
      console.log(`👤 User already exists (ID: ${existingUser.id})`);
      console.log(`   Updating Todoist token...`);

      await sql`
        UPDATE users SET
          todoist_access_token = ${todoistToken},
          status = 'active',
          onboarding_step = 'complete',
          updated_at = NOW()
        WHERE phone_number = ${phoneNumber}
      `;

      console.log(`✅ Updated user with new Todoist token`);
    } else {
      // Insert new user
      const [newUser] = await sql`
        INSERT INTO users (
          phone_number,
          todoist_access_token,
          status,
          onboarding_step,
          timezone
        ) VALUES (
          ${phoneNumber},
          ${todoistToken},
          'active',
          'complete',
          'America/New_York'
        )
        RETURNING id
      `;

      console.log(`✅ Created new user`);
      console.log(`   ID: ${newUser.id}`);
    }

    console.log(`   Phone: ${phoneNumber}`);
    console.log(`   Status: active`);
    console.log(`   Timezone: America/New_York`);
    console.log(`   Todoist: ✓ Connected`);

    await sql.end();
  } catch (error) {
    console.error('❌ Failed to add user:', error.message || error);
    await sql.end();
    process.exit(1);
  }
}

main();
