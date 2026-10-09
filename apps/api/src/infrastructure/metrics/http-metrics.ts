import { Histogram } from '@prometheus-io/client';
import type { Registry } from '@prometheus-io/client';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Route template (`/api/v1/payments/:id`), never the URL: ids in labels would grow the series without bound. */
export function httpMetrics(registry: Registry): RequestHandler {
  const histogram = new Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'HTTP server latency',
    labelNames: ['method', 'route', 'status_class'],
    registers: [registry],
  });
  return (req: Request, res: Response, next: NextFunction) => {
    const end = histogram.startTimer();
    res.on('finish', () => {
      const route = req.route
        ? `${req.baseUrl}${String((req.route as { path: unknown }).path)}`
        : 'unmatched';
      end({ method: req.method, route, status_class: `${Math.floor(res.statusCode / 100)}xx` });
    });
    next();
  };
}
