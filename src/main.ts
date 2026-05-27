import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Full HTTP app: serves the admin REST API while BotService runs the
  // Telegram long-polling bot in the background (started in its onModuleInit).
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(app.get(ConfigService).get<string>('PORT', '3000'));

  app.setGlobalPrefix('api');
  app.enableCors();

  await app.listen(port);
  Logger.log(`VoiceVault API listening on :${port}`, 'Bootstrap');
}

void bootstrap();
