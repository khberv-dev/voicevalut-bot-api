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
import { TranscriptionService } from '../ai/transcription.service';
import { BillingService } from '../billing/billing.service';
import { StorageService } from '../storage/storage.service';
import { Transcript } from '../transcripts/transcript.entity';
import { TranscriptsService } from '../transcripts/transcripts.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { BTN_BALANCE, BTN_HISTORY, PHONE_BUTTON, messages } from './messages';

type Action = 'transcribe' | 'summarize';

/** Relative URL for a stored voice file, derived from Telegram's stable id. */
function voiceAudioPath(fileUniqueId: string): string {
  return `voice/${fileUniqueId}.ogg`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

const MESSAGE_LIMIT = 4096; // Telegram text message length cap
const HISTORY_PAGE_SIZE = 5;

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

  /** Persistent main keyboard shown to registered users. */
  private readonly mainKeyboard = new Keyboard()
    .text(BTN_BALANCE)
    .text(BTN_HISTORY)
    .resized()
    .persistent();

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
          reply_markup: this.mainKeyboard,
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(messages.askPhone, {
          reply_markup: this.phoneKeyboard,
          parse_mode: 'HTML',
        });
      }
    });

    // /balance and keyboard button — show the user's current coin balance.
    this.bot.command('balance', (ctx) => this.handleBalance(ctx));
    this.bot.hears(BTN_BALANCE, (ctx) => this.handleBalance(ctx));

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
        reply_markup: this.mainKeyboard,
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
        voiceAudioPath(ctx.message.voice.file_unique_id),
      );

      await ctx.reply(messages.chooseAction, {
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

    // /history — show the user's transcript history (page 0).
    // /history and keyboard button — show the user's transcript history.
    this.bot.command('history', (ctx) => this.handleHistory(ctx));
    this.bot.hears(BTN_HISTORY, (ctx) => this.handleHistory(ctx));

    // Paginate the history list.
    this.bot.callbackQuery(/^hist_p_(\d+)$/, async (ctx) => {
      const from = ctx.from;
      if (!from) {
        await ctx.answerCallbackQuery();
        return;
      }
      const page = Number(ctx.match[1]);
      const user = await this.users.findByTelegramId(from.id);
      if (!user) {
        await ctx.answerCallbackQuery();
        return;
      }
      await ctx.answerCallbackQuery();
      const { text, keyboard } = await this.buildHistoryPage(user, page);
      await ctx.editMessageText(text, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
    });

    // Open the detail view for one history entry.
    this.bot.callbackQuery(/^hist_v_(\d+)_(\d+)$/, async (ctx) => {
      const id = Number(ctx.match[1]);
      const page = Number(ctx.match[2]);
      await ctx.answerCallbackQuery();
      const transcript = await this.transcripts.findById(id);
      if (!transcript) {
        await ctx.editMessageText(messages.historyNotFound, {
          parse_mode: 'HTML',
        });
        return;
      }
      const { text, keyboard } = this.buildDetailView(transcript, page);
      await ctx.editMessageText(text, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
      });
    });
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
   * Edit the bot's text reply; pass a keyboard to keep buttons, omit it to
   * remove them. `html` controls parse mode — keep it off for user content
   * (e.g. the transcription/summary result), which may contain `<` or `&`.
   */
  private async setCaption(
    ctx: CallbackQueryContext<Context>,
    text: string,
    keyboard?: InlineKeyboard,
    html = true,
  ): Promise<void> {
    await ctx.editMessageText(text, {
      reply_markup: keyboard,
      parse_mode: html ? 'HTML' : undefined,
    });
  }

  /** Run the chosen action on the voice attached to the callback's message. */
  private async handleAction(
    ctx: CallbackQueryContext<Context>,
    action: Action,
  ): Promise<void> {
    // The buttons are on a text reply whose reply_to_message is the original
    // voice note — that's where the stable file_unique_id lives.
    const from = ctx.from;
    const message = ctx.callbackQuery.message;
    const replyTo =
      message && 'reply_to_message' in message
        ? message.reply_to_message
        : undefined;
    const voice = replyTo && 'voice' in replyTo ? replyTo.voice : undefined;
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
    const existing = await this.transcripts.find(
      user,
      voiceAudioPath(voice.file_unique_id),
    );
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
      const updated = await this.transcripts.find(
        user,
        voiceAudioPath(voice.file_unique_id),
      );
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
        audioPath: voiceAudioPath(voice.file_unique_id),
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
          audioPath: voiceAudioPath(voice.file_unique_id),
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
        audioPath: voiceAudioPath(voice.file_unique_id),
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
    // Filename is deterministic (matches the stored audioPath key).
    const filename = `${file.file_unique_id}.ogg`;
    await this.storage
      .saveVoice(audio, filename)
      .catch((err) =>
        this.logger.warn(`Could not save voice file: ${String(err)}`),
      );

    return audio;
  }

  private async handleBalance(ctx: Context): Promise<void> {
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
  }

  private async handleHistory(ctx: Context): Promise<void> {
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
    const { text, keyboard } = await this.buildHistoryPage(user, 0);
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
  }

  /** Build the paginated history list message and its inline keyboard. */
  private async buildHistoryPage(
    user: User,
    page: number,
  ): Promise<{ text: string; keyboard: InlineKeyboard }> {
    const total = await this.transcripts.countByUser(user);
    if (total === 0) {
      return { text: messages.historyEmpty, keyboard: new InlineKeyboard() };
    }

    const totalPages = Math.ceil(total / HISTORY_PAGE_SIZE);
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const items = await this.transcripts.findByUser(
      user,
      safePage * HISTORY_PAGE_SIZE,
      HISTORY_PAGE_SIZE,
    );

    const lines: string[] = [messages.historyHeader(safePage + 1, totalPages)];
    for (let i = 0; i < items.length; i++) {
      const n = safePage * HISTORY_PAGE_SIZE + i + 1;
      lines.push(
        messages.historyEntry(
          n,
          items[i].createdAt,
          items[i].language,
          !!items[i].text,
          !!items[i].summary,
        ),
      );
    }

    const keyboard = new InlineKeyboard();
    for (let i = 0; i < items.length; i++) {
      const n = safePage * HISTORY_PAGE_SIZE + i + 1;
      keyboard.text(
        messages.historyBtnView(n),
        `hist_v_${items[i].id}_${safePage}`,
      );
    }

    if (totalPages > 1) {
      keyboard.row();
      if (safePage > 0) {
        keyboard.text(messages.historyBtnPrev, `hist_p_${safePage - 1}`);
      }
      if (safePage < totalPages - 1) {
        keyboard.text(messages.historyBtnNext, `hist_p_${safePage + 1}`);
      }
    }

    return { text: lines.join('\n'), keyboard };
  }

  /** Build the detail view for one transcript entry. */
  private buildDetailView(
    transcript: Transcript,
    page: number,
  ): { text: string; keyboard: InlineKeyboard } {
    let text = messages.historyDetailHeader(transcript.createdAt);

    if (!transcript.text && !transcript.summary) {
      text += '\n\n' + messages.historyDetailEmpty;
    } else {
      if (transcript.text) {
        text += messages.historyDetailText(
          truncate(escapeHtml(transcript.text), 1800),
        );
      }
      if (transcript.summary) {
        text += messages.historyDetailSummary(
          truncate(escapeHtml(transcript.summary), 1800),
        );
      }
    }

    const keyboard = new InlineKeyboard().text(
      messages.historyBtnBack,
      `hist_p_${page}`,
    );
    return { text, keyboard };
  }

  /**
   * Put the result in the bot's reply and restore the action buttons.
   * Text messages are capped at 4096 chars, so longer output is sent as
   * follow-up messages instead.
   */
  private async deliverResult(
    ctx: CallbackQueryContext<Context>,
    text: string,
    existing: Transcript | null,
  ): Promise<void> {
    const keyboard = this.actionKeyboard(existing);
    if (text.length <= MESSAGE_LIMIT) {
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
