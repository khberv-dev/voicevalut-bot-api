import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from '../billing/billing.service';
import { CoinTransaction } from '../billing/coin-transaction.entity';
import { TranscriptsService } from '../transcripts/transcripts.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AddCoinsDto } from './dto/add-coins.dto';

function serializeTransaction(t: CoinTransaction) {
  return {
    id: t.id,
    amount: t.amount,
    type: t.type,
    balanceAfter: t.balanceAfter,
    description: t.description,
    createdAt: t.createdAt,
  };
}

function publicUser(user: User) {
  return {
    id: user.id,
    telegramId: user.telegramId,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    coins: user.coins,
    createdAt: user.createdAt,
  };
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly transcripts: TranscriptsService,
    private readonly billing: BillingService,
  ) {}

  /** All users with their per-user transcription/summary counts and balance. */
  @Get()
  async list() {
    const [users, stats] = await Promise.all([
      this.users.findAll(),
      this.transcripts.statsByUser(),
    ]);
    return users.map((user) => ({
      ...publicUser(user),
      transcriptions: stats.get(user.id)?.transcriptions ?? 0,
      summaries: stats.get(user.id)?.summaries ?? 0,
    }));
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const stats = await this.transcripts.statsByUser();
    return {
      ...publicUser(user),
      transcriptions: stats.get(user.id)?.transcriptions ?? 0,
      summaries: stats.get(user.id)?.summaries ?? 0,
    };
  }

  /** Admin credits coins to a user. */
  @Post(':id/coins')
  async addCoins(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddCoinsDto,
  ) {
    const transaction = await this.billing.credit(
      id,
      dto.amount,
      dto.description,
    );
    return {
      userId: id,
      balance: transaction.balanceAfter,
      transaction: serializeTransaction(transaction),
    };
  }

  @Get(':id/transactions')
  async transactions(@Param('id', ParseIntPipe) id: number) {
    const transactions = await this.billing.listByUser(id);
    return transactions.map(serializeTransaction);
  }
}
