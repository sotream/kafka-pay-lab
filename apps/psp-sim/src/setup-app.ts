import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureApp(app: NestExpressApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // `public/` sits next to `src/` and `dist/`, so one relative path works for both dev and prod.
  app.useStaticAssets(join(import.meta.dirname, '..', 'public'));
}
