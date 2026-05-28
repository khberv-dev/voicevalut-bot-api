import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TranscriptsModule } from '../transcripts/transcripts.module';
import { UsersModule } from '../users/users.module';
import { StatsController } from './stats.controller';
import { TransactionsController } from './transactions.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule, BillingModule, TranscriptsModule, UsersModule, NotificationsModule],
  controllers: [UsersController, StatsController, TransactionsController],
})
export class AdminModule {}
