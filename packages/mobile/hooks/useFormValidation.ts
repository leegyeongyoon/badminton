import { useState, useCallback, useMemo } from 'react';
import type { ValidationRule } from '../utils/validation';

export interface UseFormValidation<T extends Record<string, string>> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  setValue: (field: keyof T, value: string) => void;
  setTouched: (field: keyof T) => void;
  validate: () => boolean;
  validateField: (field: keyof T) => string | null;
  isValid: boolean;
  reset: () => void;
}

/**
 * Form validation hook.
 * @param initialValues - Initial form field values
 * @param rules - Map of field names to validation rules
 */
export function useFormValidation<T extends Record<string, string>>(
  initialValues: T,
  rules: Partial<Record<keyof T, ValidationRule>>,
): UseFormValidation<T> {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouchedMap] = useState<Partial<Record<keyof T, boolean>>>({});

  const setValue = useCallback(
    (field: keyof T, value: string) => {
      setValues((prev) => ({ ...prev, [field]: value }));
      // Clear error when user starts typing again
      setErrors((prev) => {
        if (prev[field]) {
          const next = { ...prev };
          delete next[field];
          return next;
        }
        return prev;
      });
    },
    [],
  );

  const validateField = useCallback(
    (field: keyof T): string | null => {
      const rule = rules[field];
      if (!rule) return null;
      const error = rule(values[field]);
      setErrors((prev) => {
        if (error) {
          return { ...prev, [field]: error };
        }
        const next = { ...prev };
        delete next[field];
        return next;
      });
      return error;
    },
    [values, rules],
  );

  const setTouched = useCallback(
    (field: keyof T) => {
      setTouchedMap((prev) => ({ ...prev, [field]: true }));
      // Validate field on blur
      const rule = rules[field];
      if (rule) {
        const error = rule(values[field]);
        setErrors((prev) => {
          if (error) {
            return { ...prev, [field]: error };
          }
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    },
    [values, rules],
  );

  const validate = useCallback((): boolean => {
    const newErrors: Partial<Record<keyof T, string>> = {};
    const allTouched: Partial<Record<keyof T, boolean>> = {};
    let valid = true;

    for (const field of Object.keys(rules) as (keyof T)[]) {
      const rule = rules[field];
      if (!rule) continue;
      allTouched[field] = true;
      const error = rule(values[field]);
      if (error) {
        newErrors[field] = error;
        valid = false;
      }
    }

    setErrors(newErrors);
    setTouchedMap((prev) => ({ ...prev, ...allTouched }));
    return valid;
  }, [values, rules]);

  const isValid = useMemo(() => {
    for (const field of Object.keys(rules) as (keyof T)[]) {
      const rule = rules[field];
      if (!rule) continue;
      if (rule(values[field])) return false;
    }
    return true;
  }, [values, rules]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouchedMap({});
  }, [initialValues]);

  return {
    values,
    errors,
    touched,
    setValue,
    setTouched,
    validate,
    validateField,
    isValid,
    reset,
  };
}
