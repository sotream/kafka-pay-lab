import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { startTracing } from './telemetry/tracing.js';

/** Same root `.env` as the api, so OTEL_ENABLED and LOG_DIR apply to both. Existing variables win. */
function loadRootEnv(): void {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
  } catch {
    // No .env file: defaults apply.
  }
}

async function bootstrap(): Promise<void> {
  loadRootEnv();
  // Only the charge calls are worth a trace; the control page and its event stream are noise.
  await startTracing('kafka-pay-lab-psp-sim', (url) => !url.startsWith('/charges'));
  // Imported only now, after the HTTP instrumentation had its chance to patch node:http.
  const [{ NestFactory }, { AppModule }, { configureApp }] = await Promise.all([
    import('@nestjs/core'),
    import('./app.module.js'),
    import('./setup-app.js'),
  ]);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  const port = Number(process.env.PSP_SIM_PORT ?? 4100);
  await app.listen(port);
  console.log(`psp-sim control page: http://localhost:${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
