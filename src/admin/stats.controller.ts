import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from '../billing/billing.service';
import { TranscriptsService } from '../transcripts/transcripts.service';
import { UsersService } from '../users/users.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(
    private readonly users: UsersService,
    private readonly transcripts: TranscriptsService,
    private readonly billing: BillingService,
  ) {}

  /** Bot usage + transcription + billing overview. */
  @Get()
  async overview() {
    const [userCount, transcripts, billing] = await Promise.all([
      this.users.count(),
      this.transcripts.totals(),
      this.billing.totals(),
    ]);
    return {
      users: userCount,
      transcripts: transcripts.records,
      transcriptions: transcripts.transcriptions,
      summaries: transcripts.summaries,
      totalCoins: billing.totalCoins,
      coinTransactions: billing.transactionCount,
    };
  }
}
