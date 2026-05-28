import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Transcript } from './transcript.entity';

export interface SaveTranscriptionInput {
  user: User;
  audioPath: string;
  language: string;
  text: string;
}

export interface SaveSummaryInput {
  user: User;
  audioPath: string;
  language: string;
  summary: string;
}

@Injectable()
export class TranscriptsService {
  constructor(
    @InjectRepository(Transcript)
    private readonly transcripts: Repository<Transcript>,
  ) {}

  /** Find this user's saved record for a given voice, if any. */
  find(user: User, audioPath: string): Promise<Transcript | null> {
    return this.transcripts.findOne({
      where: { user: { id: user.id }, audioPath },
    });
  }

  /** Upsert the transcription text, preserving any cached summary. */
  async saveTranscription(input: SaveTranscriptionInput): Promise<Transcript> {
    const row = await this.findOrCreate(input.user, input.audioPath);
    row.language = input.language;
    row.text = input.text;
    return this.transcripts.save(row);
  }

  /** Upsert the cached summary, preserving any transcription text. */
  async saveSummary(input: SaveSummaryInput): Promise<Transcript> {
    const row = await this.findOrCreate(input.user, input.audioPath);
    row.language = input.language;
    row.summary = input.summary;
    return this.transcripts.save(row);
  }

  /** Upsert both the transcription and the summary in a single write. */
  async saveTranscriptionAndSummary(
    input: SaveTranscriptionInput & { summary: string },
  ): Promise<Transcript> {
    const row = await this.findOrCreate(input.user, input.audioPath);
    row.language = input.language;
    row.text = input.text;
    row.summary = input.summary;
    return this.transcripts.save(row);
  }

  private async findOrCreate(
    user: User,
    audioPath: string,
  ): Promise<Transcript> {
    const existing = await this.find(user, audioPath);
    return existing ?? this.transcripts.create({ user, audioPath });
  }

  /** Overall counts: total records, and how many have a transcription / summary. */
  async totals(): Promise<{
    records: number;
    transcriptions: number;
    summaries: number;
  }> {
    const row = await this.transcripts
      .createQueryBuilder('t')
      .select('COUNT(*)::int', 'records')
      .addSelect('COUNT(t.text)::int', 'transcriptions')
      .addSelect('COUNT(t.summary)::int', 'summaries')
      .getRawOne<{
        records: number;
        transcriptions: number;
        summaries: number;
      }>();
    return row ?? { records: 0, transcriptions: 0, summaries: 0 };
  }

  /** All transcripts across users, newest first, with the owning user loaded. */
  listAll(options?: { limit?: number; offset?: number }): Promise<Transcript[]> {
    return this.transcripts.find({
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  findByUser(user: User, skip: number, take: number): Promise<Transcript[]> {
    return this.transcripts.find({
      where: { user: { id: user.id } },
      order: { createdAt: 'DESC' },
      skip,
      take,
    });
  }

  countByUser(user: User): Promise<number> {
    return this.transcripts.count({ where: { user: { id: user.id } } });
  }

  findById(id: number): Promise<Transcript | null> {
    return this.transcripts.findOne({ where: { id } });
  }

  /** Per-user transcription/summary counts, keyed by user id. */
  async statsByUser(): Promise<
    Map<number, { transcriptions: number; summaries: number }>
  > {
    const rows = await this.transcripts
      .createQueryBuilder('t')
      .select('t.user_id', 'userId')
      .addSelect('COUNT(t.text)::int', 'transcriptions')
      .addSelect('COUNT(t.summary)::int', 'summaries')
      .groupBy('t.user_id')
      .getRawMany<{
        userId: number;
        transcriptions: number;
        summaries: number;
      }>();

    const stats = new Map<
      number,
      { transcriptions: number; summaries: number }
    >();
    for (const row of rows) {
      stats.set(Number(row.userId), {
        transcriptions: row.transcriptions,
        summaries: row.summaries,
      });
    }
    return stats;
  }
}
