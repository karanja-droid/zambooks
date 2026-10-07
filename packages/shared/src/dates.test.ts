import { expect, it } from 'vitest';
import { isIsoDate } from './dates';

it.each(['2026-10-07', '2024-02-29', '2026-12-31'])('accepts %s', (d) => expect(isIsoDate(d)).toBe(true));
it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-01', '07/10/2026', '', '2026-10-07T00:00:00Z'])(
  'rejects %j',
  (d) => expect(isIsoDate(d)).toBe(false),
);
