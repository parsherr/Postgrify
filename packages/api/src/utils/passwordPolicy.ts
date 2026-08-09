/**
 * passwordPolicy — Şifre kompleksitesi kuralları.
 *
 * Kurallar auth_settings'den dinamik okunur; yoksa güvenli varsayılan kullanılır.
 *
 * Varsayılan politika:
 *   - min_password_length: 8
 *   - password_require_uppercase: false  (geriye dönük uyumluluk)
 *   - password_require_number: false
 *   - password_require_special: false
 *
 * Production'da auth_settings tablosundan güçlü kurallar etkinleştirilebilir.
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
  /** Geçersizse kullanıcıya gösterilecek hata mesajı. */
  message?: string;
}

/**
 * Şifreyi politikaya göre doğrular.
 *
 * @param password - Düz metin şifre (hash'lenmemiş)
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

  // Tümü boşluk kontrolü — "        " gibi şifreleri engelle
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
 * auth_settings satırlarından PasswordPolicy nesnesi üretir.
 * `getAuthSetting()` sonuçlarıyla kullanılır.
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