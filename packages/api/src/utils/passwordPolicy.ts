/**
 * passwordPolicy — Password complexity rules.
 *
 * Rules are read dynamically from auth_settings; falls back to secure defaults.
 *
 * Default policy:
 *   - min_password_length: 8
 *   - password_require_uppercase: false  (backward compatibility)
 *   - password_require_number: false
 *   - password_require_special: false
 *
 * Strong rules can be enabled from the auth_settings table in production.
 */

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: false,
  requireNumber: false,
  requireSpecial: false,
};

export interface PasswordValidationResult {
  valid: boolean;
  /** Error message to show the user if validation fails. */
  message?: string;
}

/**
 * Validates a password against the policy.
 *
 * @param password - Plain text password (unhashed)
 * @param policy   - Uygulanacak politika; eksik alanlar DEFAULT_PASSWORD_POLICY ile doldurulur
 */
export function validatePassword(
  password: string,
  policy: Partial<PasswordPolicy> = {}
): PasswordValidationResult {
  const effective: PasswordPolicy = { ...DEFAULT_PASSWORD_POLICY, ...policy };

  if (!password || typeof password !== "string") {
    return { valid: false, message: "Password must be a non-empty string" };
  }

  // All-whitespace check — block passwords like "        "
  if (password.trim().length === 0) {
    return { valid: false, message: "Password must not consist only of whitespace" };
  }

  if (password.length < effective.minLength) {
    return {
      valid: false,
      message: `Password must be at least ${effective.minLength} characters`,
    };
  }

  if (effective.requireUppercase && !/[A-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one uppercase letter" };
  }

  if (effective.requireNumber && !/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one number" };
  }

  if (effective.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one special character",
    };
  }

  return { valid: true };
}

/**
 * Builds a PasswordPolicy object from auth_settings rows.
 * Used with the results of `getAuthSetting()`.
 */
export function parsePolicyFromSettings(
  settings: Record<string, string>
): Partial<PasswordPolicy> {
  const policy: Partial<PasswordPolicy> = {};

  const minLen = parseInt(settings["min_password_length"] ?? "", 10);
  if (!isNaN(minLen) && minLen > 0) policy.minLength = minLen;

  if (settings["password_require_uppercase"] === "true") policy.requireUppercase = true;
  if (settings["password_require_number"]    === "true") policy.requireNumber    = true;
  if (settings["password_require_special"]   === "true") policy.requireSpecial   = true;

  return policy;
}