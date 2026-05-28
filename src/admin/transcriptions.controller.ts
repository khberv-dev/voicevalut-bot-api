import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Transcript } from '../transcripts/transcript.entity';
import { TranscriptsService } from '../transcripts/transcripts.service';
import { ListTranscriptionsQuery } from './dto/list-transcriptions.query';

function serialize(t: Transcript) {
  return {
    id: t.id,
    audioPath: t.audioPath,
    language: t.language,
    text: t.text,
    summary: t.summary,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    user: t.user
      ? { id: t.user.id, telegramId: t.user.telegramId, fullName: t.user.fullName }
      : null,
  };
}

@Controller('transcriptions')
@UseGuards(JwtAuthGuard)
export class TranscriptionsController {
  constructor(private readonly transcripts: TranscriptsService) {}

  /** All transcriptions across users (newest first; optional pagination). */
  @Get()
  async list(@Query() query: ListTranscriptionsQuery) {
    const items = await this.transcripts.listAll({
      limit: query.limit,
      offset: query.offset,
    });
    return items.map(serialize);
  }
}
