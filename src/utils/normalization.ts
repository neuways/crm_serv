/**
 * Utility functions for consistent data normalization and validation across Enquiry operations.
 */

// Regular expressions for Indian mobile numbers
// Standard Indian mobile numbers are 10 digits starting with 6, 7, 8, or 9.
const INDIAN_10_DIGIT_REGEX = /^[6-9]\d{9}$/;
const INDIAN_WITH_ZERO_REGEX = /^0[6-9]\d{9}$/;
const INDIAN_WITH_91_REGEX = /^(?:\+91|91)[6-9]\d{9}$/;

// E.164 international phone number format: + followed by 7 to 15 digits
const GENERAL_E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Checks if a mobile phone number input is in a recognized valid format (Indian or international E.164).
 */
export const isValidMobile = (mobile: string): boolean => {
  if (!mobile || typeof mobile !== 'string') return false;

  const trimmed = mobile.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  // Must have between 7 and 15 digits per ITU-T E.164 standard
  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
    return false;
  }

  // Check Indian formats
  if (INDIAN_10_DIGIT_REGEX.test(digitsOnly)) return true;
  if (INDIAN_WITH_ZERO_REGEX.test(digitsOnly)) return true;
  if (INDIAN_WITH_91_REGEX.test(digitsOnly)) return true;
  if (trimmed.startsWith('+91') && INDIAN_10_DIGIT_REGEX.test(digitsOnly.slice(2))) return true;

  // Check general international format with country code prefix (e.g., +1..., +44...)
  if (trimmed.startsWith('+')) {
    const internationalNormalized = `+${digitsOnly}`;
    return GENERAL_E164_REGEX.test(internationalNormalized);
  }

  return false;
};

/**
 * Normalizes a mobile phone number:
 * - For Indian numbers: Formats into canonical '+91' + 10-digit format.
 *   Recognizes 10 digits starting with 6-9, leading 0, 91 prefix, or +91 prefix.
 * - For other international numbers: Formats to standard E.164 '+<digits>'.
 * - Throws an Error if the number format is invalid.
 */
export const normalizeMobile = (mobile: string): string => {
  if (!mobile || typeof mobile !== 'string') {
    throw new Error('Mobile number is required and must be a string');
  }

  const trimmed = mobile.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  // Case 1: 10-digit Indian mobile number (e.g., "9876543210")
  if (INDIAN_10_DIGIT_REGEX.test(digitsOnly)) {
    return `+91${digitsOnly}`;
  }

  // Case 2: 11-digit Indian number starting with '0' (e.g., "09876543210")
  if (INDIAN_WITH_ZERO_REGEX.test(digitsOnly)) {
    return `+91${digitsOnly.slice(1)}`;
  }

  // Case 3: 12-digit Indian number with '91' prefix (e.g., "919876543210" or "+91 98765 43210")
  if (trimmed.startsWith('+91') || digitsOnly.startsWith('91')) {
    const last10 = digitsOnly.slice(-10);
    if (INDIAN_10_DIGIT_REGEX.test(last10)) {
      return `+91${last10}`;
    }
  }

  // Case 4: International number starting with '+'
  if (trimmed.startsWith('+')) {
    const internationalFormatted = `+${digitsOnly}`;
    if (GENERAL_E164_REGEX.test(internationalFormatted)) {
      return internationalFormatted;
    }
  }

  throw new Error(
    `Invalid mobile phone number format: "${mobile}". Expected a valid 10-digit Indian mobile number (e.g. 9876543210, +91 98765 43210) or international E.164 number.`
  );
};

/**
 * Normalizes an email address for consistent search, indexing, and duplicate checking.
 * Converts to lowercase and trims whitespace. Returns undefined if the email is empty or omitted.
 */
export const normalizeEmail = (email?: string | null): string | undefined => {
  if (!email || typeof email !== 'string') return undefined;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
};
