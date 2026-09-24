import { z } from 'zod';

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const analyticsQueryDto = z.object({
  /** Length of the period, in days (the previous period of the same length is returned too). */
  days: z.coerce.number().int().min(1).max(90).default(30),
  /** IANA time zone the days are counted in, e.g. Asia/Kathmandu. */
  tz: z.string().max(64).refine(isTimeZone, 'Unknown time zone').default('UTC'),
});
export type AnalyticsQueryDto = z.infer<typeof analyticsQueryDto>;
