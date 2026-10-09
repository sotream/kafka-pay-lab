import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Registry } from '@prometheus-io/client';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { EnvironmentVariables } from './infrastructure/config/env.validation.js';
import { httpMetrics } from './infrastructure/metrics/http-metrics.js';

/** Every JSON body in this API is a few hundred bytes; the express default (100kb) is already generous. */
const JSON_BODY_LIMIT = '100kb';

/** HTTP-level setup shared by the real server and e2e tests, so tests exercise the same behaviour. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // First, so requests that are rejected further down are still counted.
  app.use(httpMetrics(app.get(Registry)));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}

/** Swagger UI documents every route, so it is a dev tool only. */
export function setupSwagger(app: INestApplication): void {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  if (config.get('APP_ENV', { infer: true }) !== 'dev') return;
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('kafka-pay-lab API').setVersion('1').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, document);
}
