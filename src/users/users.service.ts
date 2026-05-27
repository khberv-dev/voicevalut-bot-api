import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

export interface RegisterUserInput {
  telegramId: number;
  fullName: string;
  phoneNumber: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  findByTelegramId(telegramId: number): Promise<User | null> {
    return this.users.findOne({ where: { telegramId: String(telegramId) } });
  }

  async isRegistered(telegramId: number): Promise<boolean> {
    const count = await this.users.countBy({ telegramId: String(telegramId) });
    return count > 0;
  }

  /** Create the user, or update their details if they re-register. */
  async register(input: RegisterUserInput): Promise<User> {
    const existing = await this.findByTelegramId(input.telegramId);
    const user =
      existing ?? this.users.create({ telegramId: String(input.telegramId) });
    user.fullName = input.fullName;
    user.phoneNumber = input.phoneNumber;
    return this.users.save(user);
  }

  findAll(): Promise<User[]> {
    return this.users.find({ order: { createdAt: 'DESC' } });
  }

  findById(id: number): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  count(): Promise<number> {
    return this.users.count();
  }
}
