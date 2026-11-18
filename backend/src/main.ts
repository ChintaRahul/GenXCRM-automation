import './load-env'; // MUST stay first — loads .env.local before Prisma/@nestjs/config run
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import session from 'express-session';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const logger = new Logger('Bootstrap');

  // Default body-parser limit (100kb) is too small for CSV/Excel lead imports,
  // which send the full parsed row set as one JSON POST body.
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { limit: '15mb', extended: true });

  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? 'genxcrm-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, maxAge: 10 * 60 * 1000 },
    }),
  );

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  // The Capacitor native app (Android/iOS) serves its WebView from a fixed local
  // origin, so allow it unconditionally alongside the env-configured web origins.
  const nativeAppOrigins = ['https://localhost', 'capacitor://localhost'];
  const corsOrigins = [
    ...(process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map(o => o.trim()),
    ...nativeAppOrigins,
  ];
  app.enableCors({ origin: corsOrigins });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`GenXCRM API running on http://localhost:${port}/api/v1`);
}

void bootstrap();
