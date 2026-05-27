import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';

/** Languages the bot is allowed to handle. Anything else is rejected. */
export type DetectedLanguage = 'uzbek' | 'russian' | 'other';

export interface TranscriptionResult {
  /** Detected spoken language. `other` means outside the supported set. */
  language: DetectedLanguage;
  /** Transcript or summary, in the original language. Empty if unsupported. */
  text: string;
}

export interface TranscribeSummarizeResult {
  language: DetectedLanguage;
  /** Verbatim transcript, in the original language. Empty if unsupported. */
  transcription: string;
  /** Concise summary, in the original language. Empty if unsupported. */
  summary: string;
}

const DETECT_RULE =
  'First detect the spoken language and set "language" to "uzbek", "russian", ' +
  'or "other".';

const TRANSCRIBE_PROMPT =
  'You transcribe voice messages. ' +
  DETECT_RULE +
  ' If the language is neither Uzbek nor Russian, leave "text" empty. ' +
  'Otherwise transcribe the speech VERBATIM in its original language — never ' +
  'translate, transliterate, or paraphrase — and put it in "text".';

const TRANSCRIBE_AND_SUMMARIZE_PROMPT =
  'You transcribe and summarize voice messages. ' +
  DETECT_RULE +
  ' If the language is neither Uzbek nor Russian, leave "transcription" and ' +
  '"summary" empty. Otherwise set "transcription" to the VERBATIM transcript ' +
  'in the original language (never translate, transliterate, or paraphrase) ' +
  'and "summary" to a concise summary in the SAME language (never translate).';

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    language: { type: Type.STRING, enum: ['uzbek', 'russian', 'other'] },
    text: { type: Type.STRING },
  },
  required: ['language', 'text'],
  propertyOrdering: ['language', 'text'],
};

const COMBINED_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    language: { type: Type.STRING, enum: ['uzbek', 'russian', 'other'] },
    transcription: { type: Type.STRING },
    summary: { type: Type.STRING },
  },
  required: ['language', 'transcription', 'summary'],
  propertyOrdering: ['language', 'transcription', 'summary'],
};

/**
 * Wraps the Google Gen AI (Gemini) SDK. Gemini accepts audio inline and
 * understands it natively, so Telegram's OGG/Opus voice notes can be sent
 * straight through without any intermediate audio conversion.
 *
 * Everything is restricted to Uzbek and Russian and never translates —
 * transcription is verbatim, and summaries stay in the original language.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.getOrThrow<string>('GEMINI_API_KEY');
    this.ai = new GoogleGenAI({ apiKey });
    this.model = config.get<string>('GEMINI_MODEL', 'gemini-2.5-flash');
  }

  /** Verbatim transcription (Uzbek/Russian only, never translated). */
  transcribe(audio: Buffer, mimeType: string): Promise<TranscriptionResult> {
    return this.analyze(audio, mimeType, TRANSCRIBE_PROMPT);
  }

  /**
   * Transcribe AND summarize in a single Gemini call. Used for the
   * summarize-from-audio path so both results can be cached (the caller pays
   * for both), letting a later transcribe reuse the cached transcript.
   */
  async transcribeAndSummarize(
    audio: Buffer,
    mimeType: string,
  ): Promise<TranscribeSummarizeResult> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { inlineData: { mimeType, data: audio.toString('base64') } },
        { text: TRANSCRIBE_AND_SUMMARIZE_PROMPT },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: COMBINED_SCHEMA,
      },
    });

    const raw = response.text?.trim();
    if (!raw) {
      throw new Error('Empty response from Gemini');
    }

    let parsed: Partial<TranscribeSummarizeResult>;
    try {
      parsed = JSON.parse(raw) as Partial<TranscribeSummarizeResult>;
    } catch (err) {
      this.logger.error(`Could not parse Gemini response: ${raw}`, err);
      throw new Error('Malformed AI response');
    }

    const language: DetectedLanguage =
      parsed.language === 'uzbek' || parsed.language === 'russian'
        ? parsed.language
        : 'other';

    return {
      language,
      transcription: (parsed.transcription ?? '').trim(),
      summary: (parsed.summary ?? '').trim(),
    };
  }

  /**
   * Summarize already-transcribed text. Used when a transcription exists in the
   * DB, so we can skip re-downloading and re-processing the audio.
   */
  async summarizeText(text: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents:
        'Summarize the following text concisely. Write the summary in the ' +
        'SAME language as the text — do not translate. Return only the ' +
        `summary.\n\nText:\n${text}`,
    });
    return response.text?.trim() ?? '';
  }

  private async analyze(
    audio: Buffer,
    mimeType: string,
    prompt: string,
  ): Promise<TranscriptionResult> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { inlineData: { mimeType, data: audio.toString('base64') } },
        { text: prompt },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const raw = response.text?.trim();
    if (!raw) {
      throw new Error('Empty response from Gemini');
    }

    let parsed: Partial<TranscriptionResult>;
    try {
      parsed = JSON.parse(raw) as Partial<TranscriptionResult>;
    } catch (err) {
      this.logger.error(`Could not parse Gemini response: ${raw}`, err);
      throw new Error('Malformed AI response');
    }

    const language: DetectedLanguage =
      parsed.language === 'uzbek' || parsed.language === 'russian'
        ? parsed.language
        : 'other';

    return { language, text: (parsed.text ?? '').trim() };
  }
}
