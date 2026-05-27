import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from '../billing/billing.service';
import { CoinTransaction } from '../billing/coin-transaction.entity';
import { ListTransactionsQuery } from './dto/list-transactions.query';

function serialize(t: CoinTransaction) {
  return {
    id: t.id,
    amount: t.amount,
    type: t.type,
    balanceAfter: t.balanceAfter,
    description: t.description,
    createdAt: t.createdAt,
    user: t.user
      ? {
          id: t.user.id,
          telegramId: t.user.telegramId,
          fullName: t.user.fullName,
        }
      : null,
  };
}

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly billing: BillingService) {}

  /** All coin transactions across users (newest first; optional pagination). */
  @Get()
  async list(@Query() query: ListTransactionsQuery) {
    const transactions = await this.billing.listAll({
      limit: query.limit,
      offset: query.offset,
    });
    return transactions.map(serialize);
  }
}
