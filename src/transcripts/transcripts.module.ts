import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transcript } from './transcript.entity';
import { TranscriptsService } from './transcripts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transcript])],
  providers: [TranscriptsService],
  exports: [TranscriptsService],
})
export class TranscriptsModule {}
