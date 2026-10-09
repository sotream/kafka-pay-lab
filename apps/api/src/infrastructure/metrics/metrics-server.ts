import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { collectDefaultMetrics } from '@prometheus-io/client';
import type { Registry } from '@prometheus-io/client';

/**
 * Serves only GET /metrics on its own port, loopback by default. The public app port (and any proxy in
 * front of it) never exposes it, and no Nest guard or throttler is bypassed because the route is not in
 * Nest at all (docs/adr/0012-grafana-stack.md).
 */
export class MetricsServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MetricsServer.name);
  private server: Server | null = null;

  constructor(
    private readonly registry: Registry,
    private readonly options: { enabled: boolean; host: string; port: number },
  ) {}

  onApplicationBootstrap(): Promise<void> {
    return this.start();
  }

  onApplicationShutdown(): Promise<void> {
    return this.stop();
  }

  async start(): Promise<void> {
    if (!this.options.enabled) return;
    collectDefaultMetrics({ register: this.registry });
    const server = createServer((req, res) => {
      if (req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' }).end();
        return;
      }
      this.registry.metrics().then(
        (body) => res.writeHead(200, { 'content-type': this.registry.contentType }).end(body),
        () => res.writeHead(500).end(),
      );
    });
    // Observability must never take the payments API down, so a busy port is only logged.
    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', (error) => {
        this.logger.error(`Metrics listener failed: ${error.message}`);
        resolve(false);
      });
      server.listen(this.options.port, this.options.host, () => resolve(true));
    });
    if (listening) this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  address(): AddressInfo | null {
    return (this.server?.address() as AddressInfo | null) ?? null;
  }
}
