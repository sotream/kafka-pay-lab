import { EventEmitter } from 'node:events';
import { Registry } from '@prometheus-io/client';
import type { Request, Response } from 'express';
import { httpMetrics } from './http-metrics.js';

function finish(
  middleware: ReturnType<typeof httpMetrics>,
  req: { method: string; baseUrl?: string; route?: { path: string } },
  status: number,
): void {
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  middleware({ baseUrl: '', ...req } as unknown as Request, res as unknown as Response, () => {});
  res.emit('finish');
}

describe('httpMetrics', () => {
  it('labels by route template, never by the concrete URL', async () => {
    const registry = new Registry();
    const middleware = httpMetrics(registry);

    finish(middleware, { method: 'GET', route: { path: '/items/:id' } }, 200);
    finish(middleware, { method: 'GET', route: { path: '/items/:id' } }, 200);

    const text = await registry.metrics();
    expect(text).toContain('route="/items/:id"');
    expect(text).toContain('status_class="2xx"');
    expect(text).toContain(
      'http_server_request_duration_seconds_count{method="GET",route="/items/:id",status_class="2xx"} 2',
    );
  });

  it('collapses unmatched URLs into one label value', async () => {
    const registry = new Registry();
    const middleware = httpMetrics(registry);

    finish(middleware, { method: 'GET' }, 404);

    expect(await registry.metrics()).toContain('route="unmatched"');
  });

  it('classifies 5xx', async () => {
    const registry = new Registry();
    const middleware = httpMetrics(registry);

    finish(middleware, { method: 'POST', route: { path: '/boom' } }, 503);

    expect(await registry.metrics()).toContain('status_class="5xx"');
  });
});
