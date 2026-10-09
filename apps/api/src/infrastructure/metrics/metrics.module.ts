import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Registry } from '@prometheus-io/client';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { MetricsServer } from './metrics-server.js';

@Global()
@Module({
  providers: [
    { provide: Registry, useFactory: () => new Registry() },
    {
      provide: MetricsServer,
      inject: [Registry, ConfigService],
      useFactory: (registry: Registry, config: ConfigService<EnvironmentVariables, true>) =>
        new MetricsServer(registry, {
          enabled: config.get('METRICS_ENABLED', { infer: true }),
          host: config.get('METRICS_HOST', { infer: true }),
          port: config.get('METRICS_PORT', { infer: true }),
        }),
    },
  ],
  exports: [Registry],
})
export class MetricsModule {}
