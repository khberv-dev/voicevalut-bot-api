import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingService } from './billing.service';
import { CoinTransaction } from './coin-transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CoinTransaction])],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
