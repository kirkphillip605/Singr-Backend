const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|authorization|cookie|api[-_]?key|access[-_]?key|secret[-_]?key|bearer)/i;

export function sanitizeLogValue<T>(value: T): T {
  return sanitize(value) as T;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  const sanitized: Record<string | symbol, unknown> = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    const raw = (value as Record<string | symbol, unknown>)[key];

    if (typeof key === 'string' && SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    sanitized[key] = sanitize(raw);
  }

  return sanitized;
}
