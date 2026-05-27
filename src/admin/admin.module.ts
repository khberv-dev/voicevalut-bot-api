import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { TranscriptsModule } from '../transcripts/transcripts.module';
import { UsersModule } from '../users/users.module';
import { StatsController } from './stats.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule, BillingModule, TranscriptsModule, UsersModule],
  controllers: [UsersController, StatsController],
})
export class AdminModule {}
