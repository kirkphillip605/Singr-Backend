import { describe, expect, it } from 'vitest';

import { sanitizeLogValue } from '../log-sanitizer';

describe('sanitizeLogValue', () => {
  it('redacts values for sensitive keys', () => {
    const payload = {
      password: 'super-secret',
      token: 'abc',
      nested: {
        apiKey: '123',
        keep: 'value',
      },
    };

    const sanitized = sanitizeLogValue(payload);

    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.token).toBe('[REDACTED]');
    expect(sanitized.nested?.apiKey).toBe('[REDACTED]');
    expect(sanitized.nested?.keep).toBe('value');
  });

  it('handles arrays of objects', () => {
    const payload = [
      { accessToken: 'value', keep: 'ok' },
      { headers: { authorization: 'bearer 123' } },
    ];

    const sanitized = sanitizeLogValue(payload) as Array<Record<string, unknown>>;

    expect(sanitized[0]?.accessToken).toBe('[REDACTED]');
    expect(sanitized[0]?.keep).toBe('ok');
    expect((sanitized[1]?.headers as Record<string, unknown>).authorization).toBe('[REDACTED]');
  });

  it('does not modify primitive values', () => {
    expect(sanitizeLogValue('hello')).toBe('hello');
    expect(sanitizeLogValue(42)).toBe(42);
    const date = new Date();
    expect(sanitizeLogValue(date)).toBe(date);
  });
});
