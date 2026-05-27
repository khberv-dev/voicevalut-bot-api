import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type CoinTransactionType = 'admin_credit' | 'transcribe' | 'summarize';

/**
 * Append-only ledger of every coin movement: admin credits (positive) and
 * usage debits (negative). `balanceAfter` records the user's balance right
 * after the entry, for auditing.
 */
@Entity('coin_transactions')
export class CoinTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Signed amount: positive = credit, negative = debit. */
  @Column({ type: 'int' })
  amount: number;

  @Column()
  type: CoinTransactionType;

  @Column({ name: 'balance_after', type: 'int' })
  balanceAfter: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
