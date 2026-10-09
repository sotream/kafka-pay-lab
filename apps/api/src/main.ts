import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { EnvironmentVariables } from './infrastructure/config/env.validation.js';
import { loadTracingEnv, startTracing } from './infrastructure/telemetry/tracing.js';

/** Long-lived or noisy routes that would only add spans nobody reads. */
const isUntraced = (url: string): boolean => /\/(health|stream|metrics)\b/.test(url);

async function bootstrap(): Promise<void> {
  loadTracingEnv();
  await startTracing('kafka-pay-lab-api', isUntraced);
  // Imported only now, after the HTTP instrumentation had its chance to patch node:http.
  const [{ NestFactory }, { ConfigService: Config }, { Logger }, { AppModule }, setup] =
    await Promise.all([
      import('@nestjs/core'),
      import('@nestjs/config'),
      import('nestjs-pino'),
      import('./app.module.js'),
      import('./setup-app.js'),
    ]);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  setup.configureApp(app);
  setup.setupSwagger(app);

  const port = app.get<ConfigService<EnvironmentVariables, true>>(Config).get('PORT', {
    infer: true,
  });
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  // Logger may not exist yet (e.g. env validation failed), so print the message plainly.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
