import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Persists downloaded media to the local `uploads/` tree. Voice notes land in
 * `uploads/voice/`. The directory is created on boot and again before each
 * write, so it survives manual deletion at runtime.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly voiceDir = join(process.cwd(), 'uploads', 'voice');

  async onModuleInit(): Promise<void> {
    await mkdir(this.voiceDir, { recursive: true });
    this.logger.log(`Voice uploads directory ready at ${this.voiceDir}`);
  }

  /** Save a voice clip under `uploads/voice/` and return its absolute path. */
  async saveVoice(audio: Buffer, filename: string): Promise<string> {
    await mkdir(this.voiceDir, { recursive: true });
    const filePath = join(this.voiceDir, filename);
    await writeFile(filePath, audio);
    return filePath;
  }
}
