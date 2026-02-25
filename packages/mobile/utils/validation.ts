import { Strings } from '../constants/strings';

/**
 * Validation rule: takes a string value, returns error message or null.
 */
export type ValidationRule = (value: string) => string | null;

/**
 * Required field validation.
 */
export function required(value: string): string | null {
  if (!value || !value.trim()) {
    return Strings.validation.required;
  }
  return null;
}

/**
 * Minimum length validation (curried).
 */
export function minLength(min: number): ValidationRule {
  return (value: string) => {
    if (value.length < min) {
      return Strings.validation.minLength(min);
    }
    return null;
  };
}

/**
 * Maximum length validation (curried).
 */
export function maxLength(max: number): ValidationRule {
  return (value: string) => {
    if (value.length > max) {
      return Strings.validation.maxLength(max);
    }
    return null;
  };
}

/**
 * Korean phone number validation (010XXXXXXXX format).
 */
export function phone(value: string): string | null {
  if (!value) return null;
  if (!/^01[0-9]{8,9}$/.test(value)) {
    return Strings.validation.phone;
  }
  return null;
}

/**
 * Password validation (minimum 6 characters).
 */
export function password(value: string): string | null {
  if (!value) return null;
  if (value.length < 6) {
    return Strings.validation.password;
  }
  return null;
}

/**
 * Basic email format validation.
 */
export function email(value: string): string | null {
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return Strings.validation.email;
  }
  return null;
}

/**
 * Compose multiple validation rules. Returns first error encountered.
 */
export function compose(...rules: ValidationRule[]): ValidationRule {
  return (value: string) => {
    for (const rule of rules) {
      const error = rule(value);
      if (error) return error;
    }
    return null;
  };
}
