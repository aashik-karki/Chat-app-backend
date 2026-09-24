import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { HttpError } from '../../common/errors/http-error.js';
import { env } from '../../core/config/env.js';
import type { MetricsService } from './metrics.service.js';

const tokenMatches = (header: string | undefined): boolean => {
  if (!env.METRICS_TOKEN || !header?.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(env.METRICS_TOKEN);
  return received.length === expected.length && timingSafeEqual(received, expected);
};

export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** GET /api/v1/metrics/overview — admin dashboard (initial load; live updates come over the socket). */
  overview = async (_request: Request, response: Response) => {
    response.json(await this.metrics.update());
  };

  /** GET /metrics — Prometheus scrape endpoint, protected by METRICS_TOKEN. */
  prometheus = async (request: Request, response: Response) => {
    if (!env.METRICS_TOKEN) throw HttpError.notFound('ROUTE_NOT_FOUND', 'Not found');
    if (!tokenMatches(request.get('authorization'))) throw HttpError.unauthorized('Invalid metrics token');
    response.type('text/plain; version=0.0.4').send(await this.metrics.prometheus());
  };
}
