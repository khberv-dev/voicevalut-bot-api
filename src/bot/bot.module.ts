import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BillingModule } from '../billing/billing.module';
import { StorageModule } from '../storage/storage.module';
import { TranscriptsModule } from '../transcripts/transcripts.module';
import { UsersModule } from '../users/users.module';
import { BotService } from './bot.service';

@Module({
  imports: [
    AiModule,
    BillingModule,
    StorageModule,
    TranscriptsModule,
    UsersModule,
  ],
  providers: [BotService],
})
export class BotModule {}
