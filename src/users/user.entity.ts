import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Registered bot user. Mapped to a namespaced table so schema sync never
 * touches other apps that share this database.
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  // Telegram IDs can exceed 32 bits, so store as bigint. TypeORM surfaces
  // bigint columns as strings.
  @Index({ unique: true })
  @Column({ name: 'telegram_id', type: 'bigint' })
  telegramId: string;

  @Column({ name: 'full_name' })
  fullName: string;

  @Column({ name: 'phone_number' })
  phoneNumber: string;

  /** Coin balance for the billing system. Defaults to 0. */
  @Column({ type: 'int', default: 0 })
  coins: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
