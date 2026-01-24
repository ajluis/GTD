import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalizes a phone number to E.164 format.
 *
 * E.164 is the international standard format: +[country code][subscriber number]
 * Example: +19148152449
 *
 * This function handles various input formats:
 * - "914.815.2449" → "+19148152449"
 * - "(914) 815-2449" → "+19148152449"
 * - "+1-914-815-2449" → "+19148152449"
 * - "9148152449" → "+19148152449"
 *
 * @param phone - The phone number in any format
 * @param defaultCountry - Default country code if not included (default: 'US')
 * @returns The E.164 formatted phone number, or null if invalid
 */
export function normalizePhoneNumber(
  phone: string,
  defaultCountry: CountryCode = 'US'
): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Trim whitespace
  const trimmed = phone.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);

    if (!parsed || !parsed.isValid()) {
      return null;
    }

    // Return E.164 format (e.g., "+19148152449")
    return parsed.format('E.164');
  } catch {
    return null;
  }
}

/**
 * Checks if a phone number is valid.
 *
 * @param phone - The phone number to validate
 * @param defaultCountry - Default country code if not included (default: 'US')
 * @returns True if the phone number is valid
 */
export function isValidPhoneNumber(
  phone: string,
  defaultCountry: CountryCode = 'US'
): boolean {
  return normalizePhoneNumber(phone, defaultCountry) !== null;
}

/**
 * Normalizes a phone number or throws an error if invalid.
 *
 * Use this in contexts where an invalid phone number is a programming error
 * that should be caught early (e.g., after webhook validation).
 *
 * @param phone - The phone number in any format
 * @param defaultCountry - Default country code if not included (default: 'US')
 * @returns The E.164 formatted phone number
 * @throws Error if the phone number is invalid
 */
export function normalizePhoneNumberOrThrow(
  phone: string,
  defaultCountry: CountryCode = 'US'
): string {
  const normalized = normalizePhoneNumber(phone, defaultCountry);

  if (!normalized) {
    throw new Error(`Invalid phone number: ${phone}`);
  }

  return normalized;
}
