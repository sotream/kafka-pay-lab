import { Registry } from '@prometheus-io/client';
import { MetricsServer } from './metrics-server.js';

describe('MetricsServer', () => {
  const started: MetricsServer[] = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map((server) => server.stop()));
  });

  async function start(enabled = true, port = 0): Promise<MetricsServer> {
    const server = new MetricsServer(new Registry(), { enabled, host: '127.0.0.1', port });
    started.push(server);
    await server.start();
    return server;
  }

  it('serves /metrics on loopback and nothing else', async () => {
    const server = await start();
    const base = `http://127.0.0.1:${server.address()?.port}`;

    const ok = await fetch(`${base}/metrics`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('process_cpu');
    expect((await fetch(`${base}/api/v1/payments`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(405);
  });

  it('opens no listener when disabled', async () => {
    expect((await start(false)).address()).toBeNull();
  });

  it('logs and carries on when the port is taken', async () => {
    const first = await start();

    const second = await start(true, first.address()?.port ?? 0);

    expect(second.address()).toBeNull();
  });
});
