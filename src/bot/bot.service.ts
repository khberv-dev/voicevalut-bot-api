import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Bot,
  Context,
  InlineKeyboard,
  Keyboard,
  type CallbackQueryContext,
} from 'grammy';
import { extname } from 'node:path';
import { TranscriptionService } from '../ai/transcription.service';
import { BillingService } from '../billing/billing.service';
import { StorageService } from '../storage/storage.service';
import { Transcript } from '../transcripts/transcript.entity';
import { TranscriptsService } from '../transcripts/transcripts.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { PHONE_BUTTON, messages } from './messages';

type Action = 'transcribe' | 'summarize';

const CAPTION_LIMIT = 1024; // Telegram caption length cap
const MESSAGE_LIMIT = 4096; // Telegram text message length cap

// Coin cost per action. Summarizing reuses a transcript when one exists (3),
// otherwise it does the transcription work too (8 = 5 + 3). Cached results
// (already transcribed/summarized) are free.
const COST = {
  transcribe: 5,
  summarizeFromText: 3,
  summarizeFromAudio: 8,
} as const;

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private readonly token: string;
  private readonly bot: Bot;

  /** One-time keyboard asking the user to share their phone number. */
  private readonly phoneKeyboard = new Keyboard()
    .requestContact(PHONE_BUTTON)
    .resized()
    .oneTime();

  constructor(
    config: ConfigService,
    private readonly transcription: TranscriptionService,
    private readonly storage: StorageService,
    private readonly transcripts: TranscriptsService,
    private readonly users: UsersService,
    private readonly billing: BillingService,
  ) {
    this.token = config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    this.bot = new Bot(this.token);
  }

  onModuleInit(): void {
    this.registerHandlers();

    this.bot.catch((err) =>
      this.logger.error(`Update ${err.ctx.update.update_id} failed`, err.error),
    );

    // bot.start() resolves only when the bot stops, so it must not be awaited
    // here — that would block Nest's bootstrap. Long polling keeps the process
    // alive on its own.
    this.bot
      .start({
        onStart: (info) =>
          this.logger.log(`Bot @${info.username} started (long polling)`),
      })
      .catch((err) => this.logger.error('Bot failed to start', err));
  }

  async onModuleDestroy(): Promise<void> {
    await this.bot.stop();
  }

  private registerHandlers(): void {
    // /start — greet a registered user, otherwise ask them to register.
    this.bot.command('start', async (ctx) => {
      const from = ctx.from;
      if (!from) return;

      const user = await this.users.findByTelegramId(from.id);
      if (user) {
        await ctx.reply(messages.welcome(user.fullName), {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(messages.askPhone, {
          reply_markup: this.phoneKeyboard,
          parse_mode: 'HTML',
        });
      }
    });

    // /balance — show the user's current coin balance.
    this.bot.command('balance', async (ctx) => {
      const from = ctx.from;
      if (!from) return;

      const user = await this.users.findByTelegramId(from.id);
      if (!user) {
        await ctx.reply(messages.askPhone, {
          reply_markup: this.phoneKeyboard,
          parse_mode: 'HTML',
        });
        return;
      }
      await ctx.reply(messages.balance(user.coins), { parse_mode: 'HTML' });
    });

    // Registration — triggered when the user taps "share phone number".
    this.bot.on('message:contact', async (ctx) => {
      const from = ctx.from;
      const contact = ctx.message.contact;

      // The shared contact must belong to the sender. The request_contact
      // button guarantees this; a manually forwarded contact would not match.
      if (!from || contact.user_id !== from.id) {
        await ctx.reply(messages.shareOwnPhone, {
          reply_markup: this.phoneKeyboard,
          parse_mode: 'HTML',
        });
        return;
      }

      // Full name comes from the Telegram profile, not the contact card.
      const fullName = [from.first_name, from.last_name]
        .filter((part): part is string => Boolean(part))
        .join(' ');

      const user = await this.users.register({
        telegramId: from.id,
        fullName,
        phoneNumber: contact.phone_number,
      });

      await ctx.reply(messages.registered(user.fullName), {
        reply_markup: { remove_keyboard: true },
        parse_mode: 'HTML',
      });
    });

    // Voice — registered users get to choose what to do with it. The bot echoes
    // the same voice note back with a caption and two inline buttons; the actual
    // work happens when a button is pressed (see handleAction).
    this.bot.on('message:voice', async (ctx) => {
      const from = ctx.from;
      if (!from) return;

      const user = await this.users.findByTelegramId(from.id);
      if (!user) {
        await ctx.reply(messages.notRegistered, {
          reply_markup: this.phoneKeyboard,
          parse_mode: 'HTML',
        });
        return;
      }

      // Price the buttons for this voice (reused audio may already be cached).
      const existing = await this.transcripts.find(
        user,
        ctx.message.voice.file_unique_id,
      );

      await ctx.replyWithVoice(ctx.message.voice.file_id, {
        caption: messages.chooseAction,
        reply_markup: this.actionKeyboard(existing),
        reply_parameters: { message_id: ctx.message.message_id },
        parse_mode: 'HTML',
      });
    });

    this.bot.callbackQuery('transcribe', (ctx) =>
      this.handleAction(ctx, 'transcribe'),
    );
    this.bot.callbackQuery('summarize', (ctx) =>
      this.handleAction(ctx, 'summarize'),
    );
  }

  /**
   * Action buttons (one per row) labelled with their current coin cost
   * (cache-dependent).
   */
  private actionKeyboard(existing: Transcript | null): InlineKeyboard {
    return new InlineKeyboard()
      .text(
        messages.btnTranscribe(this.costFor('transcribe', existing)),
        'transcribe',
      )
      .row()
      .text(
        messages.btnSummarize(this.costFor('summarize', existing)),
        'summarize',
      );
  }

  /**
   * Edit the caption; pass a keyboard to keep buttons, omit it to remove them.
   * `html` controls parse mode — keep it off for user content (e.g. the
   * transcription/summary result), which may contain `<` or `&`.
   */
  private async setCaption(
    ctx: CallbackQueryContext<Context>,
    caption: string,
    keyboard?: InlineKeyboard,
    html = true,
  ): Promise<void> {
    await ctx.editMessageCaption({
      caption,
      reply_markup: keyboard,
      parse_mode: html ? 'HTML' : undefined,
    });
  }

  /** Run the chosen action on the voice attached to the callback's message. */
  private async handleAction(
    ctx: CallbackQueryContext<Context>,
    action: Action,
  ): Promise<void> {
    // The button is attached to the voice note the bot echoed, so the audio
    // (and its content-stable file_unique_id) is right there on the message.
    const from = ctx.from;
    const message = ctx.callbackQuery.message;
    const voice = message && 'voice' in message ? message.voice : undefined;
    if (!from || !voice) {
      await ctx.answerCallbackQuery();
      await this.setCaption(ctx, messages.fileError);
      return;
    }

    const user = await this.users.findByTelegramId(from.id);
    if (!user) {
      await ctx.answerCallbackQuery();
      await this.setCaption(ctx, messages.notRegistered);
      return;
    }

    // Cost depends on what's already cached for this voice.
    const existing = await this.transcripts.find(user, voice.file_unique_id);
    const cost = this.costFor(action, existing);

    // Not enough balance: show an alert popup and leave the message (and its
    // buttons) untouched — don't edit the caption.
    if (cost > 0 && !this.billing.canAfford(user, cost)) {
      await ctx.answerCallbackQuery({
        text: messages.insufficientCoins(user.coins, cost),
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    // Drop the buttons while working (they're restored once the result is in).
    await this.setCaption(
      ctx,
      action === 'transcribe' ? messages.transcribing : messages.summarizing,
    );

    try {
      const text =
        action === 'transcribe'
          ? await this.runTranscribe(user, voice, existing)
          : await this.runSummarize(user, voice, existing);

      if (text === null) {
        // Unsupported language — no charge.
        await this.setCaption(ctx, messages.unsupportedLanguage);
        return;
      }

      // Charge only for work actually done (cached paths cost 0).
      if (cost > 0) {
        await this.billing.charge(user.id, cost, action, action);
      }

      // Re-read so the restored buttons show updated prices (e.g. transcribe
      // is now free) after the result is cached.
      const updated = await this.transcripts.find(user, voice.file_unique_id);
      await this.deliverResult(ctx, text || messages.noSpeech, updated);
    } catch (err) {
      this.logger.error('Failed to process voice message', err);
      // Restore the buttons so the user can retry.
      await this.setCaption(
        ctx,
        messages.processError,
        this.actionKeyboard(existing),
      );
    }
  }

  /** Coin cost for an action given what's already cached for the voice. */
  private costFor(action: Action, existing: Transcript | null): number {
    if (action === 'transcribe') {
      return existing?.text ? 0 : COST.transcribe;
    }
    if (existing?.summary) return 0;
    return existing?.text ? COST.summarizeFromText : COST.summarizeFromAudio;
  }

  /**
   * Transcribe the voice and cache the transcript. Reuses a cached transcript
   * if one exists. Returns the text, or `null` if the language is unsupported.
   */
  private async runTranscribe(
    user: User,
    voice: { file_id: string; file_unique_id: string; mime_type?: string },
    existing: Transcript | null,
  ): Promise<string | null> {
    if (existing?.text) {
      return existing.text;
    }

    const audio = await this.downloadAndSave(voice.file_id);
    const result = await this.transcription.transcribe(
      audio,
      voice.mime_type ?? 'audio/ogg',
    );

    if (result.language === 'other') return null;

    if (result.text) {
      await this.transcripts.saveTranscription({
        user,
        fileUniqueId: voice.file_unique_id,
        language: result.language,
        text: result.text,
      });
    }
    return result.text;
  }

  /**
   * Summarize the voice, caching the result. Reuse order: a cached summary →
   * a cached transcript (summarize its text, no re-download) → the audio
   * itself. Returns the summary, or `null` if the language is unsupported.
   */
  private async runSummarize(
    user: User,
    voice: { file_id: string; file_unique_id: string; mime_type?: string },
    existing: Transcript | null,
  ): Promise<string | null> {
    if (existing?.summary) {
      return existing.summary;
    }

    if (existing?.text) {
      const summary = await this.transcription.summarizeText(existing.text);
      if (summary) {
        await this.transcripts.saveSummary({
          user,
          fileUniqueId: voice.file_unique_id,
          language: existing.language,
          summary,
        });
      }
      return summary;
    }

    // No cache: transcribe + summarize in one call (the 8-coin path) and cache
    // both, so a later transcribe reuses the stored transcript for free.
    const audio = await this.downloadAndSave(voice.file_id);
    const result = await this.transcription.transcribeAndSummarize(
      audio,
      voice.mime_type ?? 'audio/ogg',
    );

    if (result.language === 'other') return null;

    if (result.transcription || result.summary) {
      await this.transcripts.saveTranscriptionAndSummary({
        user,
        fileUniqueId: voice.file_unique_id,
        language: result.language,
        text: result.transcription,
        summary: result.summary,
      });
    }
    return result.summary;
  }

  /** Download a voice file by id and persist it to uploads/voice. */
  private async downloadAndSave(fileId: string): Promise<Buffer> {
    const file = await this.bot.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error('Telegram returned no file_path');
    }

    const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());

    // Persist the original audio; failure here must not block processing.
    const ext = extname(file.file_path) || '.ogg';
    const filename = `${Date.now()}_${file.file_unique_id}${ext}`;
    await this.storage
      .saveVoice(audio, filename)
      .catch((err) =>
        this.logger.warn(`Could not save voice file: ${String(err)}`),
      );

    return audio;
  }

  /**
   * Put the result in the message caption and restore the action buttons (so
   * the user can run the other action — e.g. summarize after transcribing).
   * Captions are capped at 1024 chars, so longer output is sent as follow-up
   * text messages instead.
   */
  private async deliverResult(
    ctx: CallbackQueryContext<Context>,
    text: string,
    existing: Transcript | null,
  ): Promise<void> {
    const keyboard = this.actionKeyboard(existing);
    if (text.length <= CAPTION_LIMIT) {
      // The result is user content — send it plain (no HTML parsing).
      await this.setCaption(ctx, text, keyboard, false);
      return;
    }

    await this.setCaption(ctx, messages.resultBelow, keyboard);
    for (let i = 0; i < text.length; i += MESSAGE_LIMIT) {
      await ctx.reply(text.slice(i, i + MESSAGE_LIMIT));
    }
  }
}
