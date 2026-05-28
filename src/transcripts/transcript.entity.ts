import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * What the bot knows about one voice note: its transcription and/or its
 * summary. Belongs to a `User`, and is keyed by that user plus the voice's
 * `file_unique_id` (stable per audio content) so later actions can reuse
 * cached results instead of re-processing the audio. Either text column may be
 * null until that action is run.
 */
@Entity('transcripts')
@Unique(['user', 'audioPath'])
export class Transcript {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'audio_path' })
  audioPath: string;

  @Column()
  language: string;

  /** Verbatim transcription, or null if not transcribed yet. */
  @Column({ type: 'text', nullable: true })
  text: string | null;

  /** Cached summary, or null if not summarized yet. */
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
