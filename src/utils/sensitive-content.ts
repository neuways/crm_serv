export type ContactDetailType = 'MOBILE' | 'EMAIL';

export interface SensitiveContentScanResult {
  hasProhibitedSecrets: boolean;
  prohibitedReasons: string[];
  hasContactDetails: boolean;
  detectedContactTypes: ContactDetailType[];
}

/**
 * 1. Password & Credential Patterns
 * Matches explicit credential assignments, tokens, keys, and passcodes.
 * Conservative pattern designed to catch common credential sharing patterns.
 */
const PASSWORD_PATTERNS = [
  /\b(?:password|passwd|pwd|passcode)\s*[:=]\s*\S+/i,
  /\b(?:secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*\S+/i,
  /\bbearer\s+[a-zA-Z0-9_\-.]{16,}\b/i,
  /\b(?:sk_live|pk_live|ghp_|glpat-)[a-zA-Z0-9_\-]{16,}\b/i
];

/**
 * 2. OTP & Verification Code Patterns
 * Matches one-time passwords, verification codes, and security PINs.
 */
const OTP_PATTERNS = [
  /\b(?:otp|one[- ]?time[- ]?pass(?:word)?|verification[- ]?code|security[- ]?code|auth(?:entication)?[- ]?code)\s*(?:is|:|code|#|\-)?\s*[0-9]{4,8}\b/i,
  /\b[0-9]{4,8}\s*is\s+(?:your\s+)?(?:otp|verification\s+code|one[- ]?time\s+password)\b/i
];

/**
 * 3. Mobile Phone Patterns
 * Target Indian 10-digit mobile numbers starting with 6, 7, 8, or 9,
 * with optional +91, 91, or 0 prefixes, and optional separator spaces, dashes, or dots.
 */
const MOBILE_PATTERNS = [
  // Formats: +91 98765 43210, +91-98765-43210, +919876543210, 09876543210, 919876543210
  /(?:(?:\+91|91|0)[-\s.]*)?[6-9]\d{4}[-\s.]*\d{5}\b/,
  /(?:(?:\+91|91|0)[-\s.]*)?[6-9]\d{2}[-\s.]*\d{3}[-\s.]*\d{4}\b/,
  // Standard 10-digit mobile: 9876543210
  /\b[6-9]\d{9}\b/
];

/**
 * 4. Email Patterns
 * Standard RFC-compliant email detection pattern.
 */
const EMAIL_PATTERN = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/;

/**
 * Scans submitted remark text for sensitive credentials, OTPs, mobile numbers, and emails.
 *
 * Known Limitations:
 * - Pattern-based detection is heuristic: heavily obfuscated or spaced-out secrets (e.g. "p a s s w o r d")
 *   cannot be reliably caught without risking high false-positive rates on normal speech.
 * - Non-standard international numbers outside the Indian numbering format (+91/10-digit) may not be detected.
 * - This function does NOT guarantee that all possible credentials or secrets are caught.
 */
export function scanSensitiveContent(text: string): SensitiveContentScanResult {
  const prohibitedReasons: string[] = [];
  const detectedContactTypes: ContactDetailType[] = [];

  // 1. Check for passwords/credentials
  for (const pattern of PASSWORD_PATTERNS) {
    if (pattern.test(text)) {
      prohibitedReasons.push('CREDENTIALS');
      break;
    }
  }

  // 2. Check for OTPs
  for (const pattern of OTP_PATTERNS) {
    if (pattern.test(text)) {
      prohibitedReasons.push('OTP');
      break;
    }
  }

  // 3. Check for mobile numbers
  for (const pattern of MOBILE_PATTERNS) {
    if (pattern.test(text)) {
      detectedContactTypes.push('MOBILE');
      break;
    }
  }

  // 4. Check for emails
  if (EMAIL_PATTERN.test(text)) {
    detectedContactTypes.push('EMAIL');
  }

  return {
    hasProhibitedSecrets: prohibitedReasons.length > 0,
    prohibitedReasons,
    hasContactDetails: detectedContactTypes.length > 0,
    detectedContactTypes
  };
}
