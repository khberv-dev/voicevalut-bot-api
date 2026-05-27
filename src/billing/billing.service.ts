import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import {
  CoinTransaction,
  CoinTransactionType,
} from './coin-transaction.entity';

/** Thrown by `charge()` when a user's balance can't cover the amount. */
export class InsufficientCoinsError extends Error {}

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(CoinTransaction)
    private readonly transactions: Repository<CoinTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  canAfford(user: User, amount: number): boolean {
    return user.coins >= amount;
  }

  /** Admin credit. Returns the ledger entry (with the new balance). */
  credit(
    userId: number,
    amount: number,
    description?: string,
  ): Promise<CoinTransaction> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
    return this.apply(userId, amount, 'admin_credit', description);
  }

  /** Usage debit. Throws `InsufficientCoinsError` if the balance is too low. */
  charge(
    userId: number,
    amount: number,
    type: CoinTransactionType,
    description?: string,
  ): Promise<CoinTransaction> {
    return this.apply(userId, -amount, type, description);
  }

  listByUser(userId: number): Promise<CoinTransaction[]> {
    return this.transactions.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
    });
  }

  /** All transactions across users, newest first, with the owning user loaded. */
  listAll(options?: {
    limit?: number;
    offset?: number;
  }): Promise<CoinTransaction[]> {
    return this.transactions.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  async totals(): Promise<{ totalCoins: number; transactionCount: number }> {
    const balance = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .select('COALESCE(SUM(u.coins), 0)', 'sum')
      .getRawOne<{ sum: string }>();
    const transactionCount = await this.transactions.count();
    return { totalCoins: Number(balance?.sum ?? 0), transactionCount };
  }

  /**
   * Atomically adjust a user's balance by `delta` and append a ledger entry.
   * Locks the user row so concurrent charges can't overspend.
   */
  private apply(
    userId: number,
    delta: number,
    type: CoinTransactionType,
    description?: string,
  ): Promise<CoinTransaction> {
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const user = await users.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const balanceAfter = user.coins + delta;
      if (balanceAfter < 0) {
        throw new InsufficientCoinsError('Insufficient coins');
      }

      user.coins = balanceAfter;
      await users.save(user);

      const ledger = manager.getRepository(CoinTransaction);
      const entry = ledger.create({
        user: { id: userId } as User,
        amount: delta,
        type,
        balanceAfter,
        description: description ?? null,
      });
      return ledger.save(entry);
    });
  }
}
