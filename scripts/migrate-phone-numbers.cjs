#!/usr/bin/env node
/**
 * Phone Number Migration Script
 *
 * Normalizes phone numbers in the database to E.164 format and reports duplicates.
 *
 * What this script does:
 * 1. Queries all users from the database
 * 2. Normalizes each phone number to E.164 format
 * 3. Detects duplicates (same normalized phone, different records)
 * 4. Reports duplicates for manual merge (does NOT auto-merge to avoid data loss)
 * 5. Updates non-normalized phone numbers to E.164 format (with --apply flag)
 *
 * Usage:
 *   node scripts/migrate-phone-numbers.cjs           # Dry run - report only
 *   node scripts/migrate-phone-numbers.cjs --apply   # Apply changes
 *
 * With Railway:
 *   railway run node scripts/migrate-phone-numbers.cjs --apply
 */

const postgres = require('postgres');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Normalize phone number to E.164 format
 * @param {string} phone
 * @returns {string|null}
 */
function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  try {
    const parsed = parsePhoneNumberFromString(trimmed, 'US');
    if (!parsed || !parsed.isValid()) return null;
    return parsed.format('E.164');
  } catch {
    return null;
  }
}

async function main() {
  const applyChanges = process.argv.includes('--apply');

  console.log('═'.repeat(60));
  console.log('📱 PHONE NUMBER MIGRATION SCRIPT');
  console.log('═'.repeat(60));
  console.log('');
  console.log(`Mode: ${applyChanges ? '🔧 APPLY CHANGES' : '👁️  DRY RUN (use --apply to apply)'}`);
  console.log('');

  // Get database URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(databaseUrl);

  try {
    // 1. Query all users
    const users = await sql`
      SELECT id, phone_number, status, created_at, todoist_access_token
      FROM users
      ORDER BY created_at ASC
    `;

    console.log(`📊 Found ${users.length} users in database`);
    console.log('');

    // 2. Analyze and categorize
    const normalizedMap = new Map(); // normalized -> users[]
    const invalidPhones = [];
    const needsUpdate = [];

    for (const user of users) {
      const normalized = normalizePhoneNumber(user.phone_number);

      if (!normalized) {
        invalidPhones.push(user);
        continue;
      }

      // Track if this needs updating
      if (normalized !== user.phone_number) {
        needsUpdate.push({ user, normalized });
      }

      // Group by normalized phone
      const existing = normalizedMap.get(normalized) || [];
      existing.push(user);
      normalizedMap.set(normalized, existing);
    }

    // 3. Report duplicates
    const duplicates = Array.from(normalizedMap.entries()).filter(
      ([_, users]) => users.length > 1
    );

    if (duplicates.length > 0) {
      console.log('⚠️  DUPLICATES DETECTED (same phone, different formats)');
      console.log('─'.repeat(60));
      console.log('');

      for (const [normalized, dupeUsers] of duplicates) {
        console.log(`📞 ${normalized}`);
        for (const user of dupeUsers) {
          const hasToken = user.todoist_access_token ? '✓ Token' : '✗ No token';
          console.log(`   ├─ ID: ${user.id}`);
          console.log(`   │  Raw: ${user.phone_number}`);
          console.log(`   │  Status: ${user.status} | ${hasToken}`);
          console.log(`   │  Created: ${user.created_at.toISOString()}`);
          console.log(`   │`);
        }
        console.log('');
      }

      console.log('⚠️  ACTION REQUIRED: Manually merge duplicate users before applying updates.');
      console.log('   Recommendation: Keep the oldest user with a valid token, delete others.');
      console.log('');

      if (applyChanges) {
        console.log('❌ Cannot apply changes while duplicates exist.');
        console.log('   Please resolve duplicates first, then re-run this script.');
        await sql.end();
        process.exit(1);
      }
    }

    // 4. Report invalid phones
    if (invalidPhones.length > 0) {
      console.log('❌ INVALID PHONE NUMBERS');
      console.log('─'.repeat(60));
      for (const user of invalidPhones) {
        console.log(`   ID: ${user.id} | Phone: "${user.phone_number}"`);
      }
      console.log('');
    }

    // 5. Report phones needing update
    if (needsUpdate.length > 0) {
      console.log(`📝 PHONES NEEDING NORMALIZATION: ${needsUpdate.length}`);
      console.log('─'.repeat(60));

      for (const { user, normalized } of needsUpdate) {
        console.log(`   ${user.phone_number} → ${normalized}`);
      }
      console.log('');

      // 6. Apply updates if flag is set and no duplicates
      if (applyChanges && duplicates.length === 0) {
        console.log('🔧 Applying updates...');
        console.log('');

        let updated = 0;
        for (const { user, normalized } of needsUpdate) {
          await sql`
            UPDATE users
            SET phone_number = ${normalized}, updated_at = NOW()
            WHERE id = ${user.id}
          `;
          updated++;
          console.log(`   ✓ Updated ${user.phone_number} → ${normalized}`);
        }

        console.log('');
        console.log(`✅ Successfully updated ${updated} phone numbers`);
      }
    } else {
      console.log('✅ All phone numbers are already in E.164 format');
    }

    // 7. Summary
    console.log('');
    console.log('═'.repeat(60));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(60));
    console.log(`   Total users:    ${users.length}`);
    console.log(`   Already E.164:  ${users.length - needsUpdate.length - invalidPhones.length}`);
    console.log(`   Needs update:   ${needsUpdate.length}`);
    console.log(`   Duplicates:     ${duplicates.length}`);
    console.log(`   Invalid:        ${invalidPhones.length}`);
    console.log('');

    await sql.end();
  } catch (error) {
    console.error('❌ Migration failed:', error.message || error);
    await sql.end();
    process.exit(1);
  }
}

main();
