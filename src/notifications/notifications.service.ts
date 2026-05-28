import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { messages } from '../bot/messages';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly apiBase: string;

  constructor(config: ConfigService) {
    const token = config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  async notifyCoinCredit(
    telegramId: string,
    amount: number,
    balance: number,
  ): Promise<void> {
    await this.sendMessage(telegramId, messages.coinsAdded(amount, balance));
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    const res = await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.warn(
        `Telegram sendMessage to ${chatId} failed: ${res.status} ${body}`,
      );
    }
  }
}
