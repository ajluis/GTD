import { describe, it, expect } from 'vitest';
import {
  normalizePhoneNumber,
  isValidPhoneNumber,
  normalizePhoneNumberOrThrow,
} from './phone.js';

describe('normalizePhoneNumber', () => {
  it('normalizes dotted format (914.815.2449)', () => {
    expect(normalizePhoneNumber('914.815.2449')).toBe('+19148152449');
  });

  it('normalizes parentheses format ((914) 815-2449)', () => {
    expect(normalizePhoneNumber('(914) 815-2449')).toBe('+19148152449');
  });

  it('normalizes dashed format with country code (+1-914-815-2449)', () => {
    expect(normalizePhoneNumber('+1-914-815-2449')).toBe('+19148152449');
  });

  it('normalizes raw digits (9148152449)', () => {
    expect(normalizePhoneNumber('9148152449')).toBe('+19148152449');
  });

  it('normalizes with spaces (914 815 2449)', () => {
    expect(normalizePhoneNumber('914 815 2449')).toBe('+19148152449');
  });

  it('keeps already normalized E.164 format unchanged', () => {
    expect(normalizePhoneNumber('+19148152449')).toBe('+19148152449');
  });

  it('normalizes with leading 1 (19148152449)', () => {
    expect(normalizePhoneNumber('19148152449')).toBe('+19148152449');
  });

  it('normalizes mixed format (+1 (914) 815-2449)', () => {
    expect(normalizePhoneNumber('+1 (914) 815-2449')).toBe('+19148152449');
  });

  it('returns null for invalid phone numbers', () => {
    expect(normalizePhoneNumber('invalid')).toBeNull();
    expect(normalizePhoneNumber('123')).toBeNull();
    expect(normalizePhoneNumber('abc-def-ghij')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizePhoneNumber('')).toBeNull();
  });

  it('returns null for whitespace only', () => {
    expect(normalizePhoneNumber('   ')).toBeNull();
  });

  it('trims whitespace before parsing', () => {
    expect(normalizePhoneNumber('  914.815.2449  ')).toBe('+19148152449');
  });

  it('returns null for null-like values', () => {
    expect(normalizePhoneNumber(null as any)).toBeNull();
    expect(normalizePhoneNumber(undefined as any)).toBeNull();
  });

  it('handles international numbers with explicit country', () => {
    // UK number
    expect(normalizePhoneNumber('+44 7911 123456')).toBe('+447911123456');
  });
});

describe('isValidPhoneNumber', () => {
  it('returns true for valid phone numbers', () => {
    expect(isValidPhoneNumber('914.815.2449')).toBe(true);
    expect(isValidPhoneNumber('+19148152449')).toBe(true);
    expect(isValidPhoneNumber('(914) 815-2449')).toBe(true);
  });

  it('returns false for invalid phone numbers', () => {
    expect(isValidPhoneNumber('invalid')).toBe(false);
    expect(isValidPhoneNumber('123')).toBe(false);
    expect(isValidPhoneNumber('')).toBe(false);
  });
});

describe('normalizePhoneNumberOrThrow', () => {
  it('returns normalized phone for valid numbers', () => {
    expect(normalizePhoneNumberOrThrow('914.815.2449')).toBe('+19148152449');
    expect(normalizePhoneNumberOrThrow('+19148152449')).toBe('+19148152449');
  });

  it('throws for invalid phone numbers', () => {
    expect(() => normalizePhoneNumberOrThrow('invalid')).toThrow(
      'Invalid phone number: invalid'
    );
    expect(() => normalizePhoneNumberOrThrow('')).toThrow(
      'Invalid phone number: '
    );
  });
});
