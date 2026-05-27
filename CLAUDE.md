# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **Telegram bot that transcribes/summarizes voice messages**, built on NestJS 11, plus an **admin REST API**. Users must **register by sharing their phone number** (full name is taken from their Telegram profile); only then will the bot work. A registered user sends a voice note; the bot echoes it with Transcribe/Summarize buttons and processes via Google Gemini. **All bot-facing text is in Uzbek** (centralized in `src/bot/messages.ts`). A **coin-based billing system** charges for usage (admin tops up balances via the API).

`main.ts` runs a **full HTTP app** (`NestFactory.create`) that serves the REST API *and* runs the Telegram long-polling bot in the same process (the bot is started inside `BotService.onModuleInit`, not via HTTP). The README is still the unmodified NestJS boilerplate and does not describe this project.

The directory is not yet a git repository (only a `.gitignore` exists).

### Required environment (see `.env.example`)
`@nestjs/config` loads `.env` automatically. Most are mandatory or startup throws (`getOrThrow`):
- `PORT` — HTTP port for the REST API (default 3000; `.env` uses 8000)
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `GEMINI_API_KEY` — from https://aistudio.google.com/apikey
- `GEMINI_MODEL` — optional, defaults to `gemini-2.5-flash`
- `DB_HOST`, `DB_PORT` (default 5432), `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` — PostgreSQL connection
- `ADMIN_LOGIN`, `ADMIN_PASSWORD` — the single admin's REST API credentials
- `JWT_SECRET` — signs admin JWTs
- `NODE_ENV` — when `production`, TypeORM `synchronize` is **disabled** (otherwise on)

### REST API (admin)
All routes are under the **global `/api` prefix** (set in `main.ts`, which also enables CORS). All except login require `Authorization: Bearer <jwt>`.
- `POST /api/auth/login` — `{ login, password }` → `{ accessToken }` (validated against `ADMIN_*` env)
- `GET /api/users` — all users with `coins` + per-user `transcriptions`/`summaries` counts
- `GET /api/users/:id` — one user with the same stats
- `POST /api/users/:id/coins` — `{ amount, description? }` credits coins → `{ balance, transaction }`
- `GET /api/users/:id/transactions` — that user's coin ledger
- `GET /api/transactions` — all users' transactions, newest first, each with its owning user; optional `?limit=&offset=` (else returns all)
- `GET /api/stats` — overview: user count, transcript/transcription/summary totals, total coins, transaction count

### Billing
Costs (coins), charged only for work actually performed by Gemini (cached results are free): **transcribe = 5**, **summarize = 3** if a transcript already exists else **8** (summarizing straight from audio — which also transcribes and caches the transcript, so a later transcribe is free). New users start at 0; the bot blocks an action (Uzbek message) when the balance can't cover it. Every movement — admin credit (+) and usage debit (−) — is recorded in `coin_transactions` with the resulting `balanceAfter`.

## Commands

```bash
npm install              # install dependencies

npm run start:dev        # run with watch/hot-reload (primary dev loop)
npm run start            # run once
npm run start:prod       # run compiled output from dist/ (run `npm run build` first)

npm run build            # nest build → dist/ (wipes dist/ first, see nest-cli.json deleteOutDir)
npm run lint             # eslint --fix over {src,apps,libs,test}
npm run format           # prettier --write over src/ and test/

npm test                 # jest, all *.spec.ts under src/
npm test -- transcription    # run a single spec by filename pattern
npm run test:watch
npm run test:cov         # coverage → coverage/
```

Running locally needs the env vars above (e.g. an `.env` file). `npm run start:dev` is the main dev loop.

### Testing notes
- Unit tests are Jest (`ts-jest`), config inlined in `package.json`, `rootDir: src`, matching `*.spec.ts`. There are none yet.
- `npm run test:e2e` is wired in `package.json` but **will fail** — it points at `./test/jest-e2e.json`, and the `test/` directory does not exist. Create it before relying on e2e.

## Architecture

Standard NestJS dependency-injection layout. Wiring is explicit, not auto-discovered: a class must be listed in a module's `providers` (and the module imported into `AppModule`) before Nest will instantiate or inject it.

Flow: voice message → `BotService` checks the sender is registered (`UsersService.isRegistered`); if not, it replies in Uzbek with a "share phone number" keyboard and does nothing else. For a registered user, the bot **echoes the same voice note back** with a caption and an inline keyboard offering two actions — **Transcribe** and **Summarize**. The audio is only downloaded/processed when a button is pressed: the `callbackQuery` handler updates the caption to an "in progress" message, downloads the file via the Telegram file API, `StorageService` saves it to `uploads/voice/`, `TranscriptionService` transcribes or summarizes via Gemini, and the caption is edited to the result. **Both results are cached in the DB** (`TranscriptsService`, keyed by the owning `User` + the voice's content-stable `file_unique_id`; the callback resolves the `User` via `findByTelegramId` first). Transcribe returns a cached transcript if present, else transcribes and saves it. Summarize tries, in order: a cached summary → a cached transcript's text (summarized via `summarizeText()`, no re-download) → the audio itself (via `transcribeAndSummarize()`, one Gemini call that returns **both** transcript and summary, **both cached** — so a later transcribe is free). So repeating an action, or summarizing an already-transcribed note, avoids redundant downloads/Gemini calls. The action buttons are **restored after each result**, so a transcribed note can still be summarized afterwards. Results longer than Telegram's 1024-char caption limit are sent as follow-up text messages (chunked at 4096).

Billing gate: the action buttons are **labelled with their current coin cost** (cache-aware — `bepul`/free when a cached result makes the action cost 0). On press, the callback computes the cost from the cache state (`costFor`); if the balance can't cover it, it answers with an **alert popup and leaves the message and its buttons untouched** (no caption edit, so the user can retry after a top-up). Otherwise it debits via `BillingService.charge` only after a successful (supported-language) result. Cached results cost 0, so they're never charged. `/balance` replies with the user's current balance.

Registration flow: `/start` (or any voice from an unregistered user) shows a `Keyboard().requestContact(...)` button. When the user taps it, the `message:contact` handler verifies the contact's `user_id` matches the sender (so they can't register someone else's number), takes the **full name from the Telegram profile** (`from.first_name`/`from.last_name`) and the **phone from the shared contact**, and upserts via `UsersService.register`.

- `src/main.ts` — bootstraps the **HTTP app** (`NestFactory.create`), enables shutdown hooks, applies a global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` + `transform`), and listens on `PORT`. The bot runs alongside in the same process.
- `src/app.module.ts` — root module; wires `ConfigModule` (global) + `TypeOrmModule.forRootAsync` (Postgres, `autoLoadEntities`) + `BotModule` + `AuthModule` + `AdminModule`.
- `src/bot/` — `BotService` owns the grammY `Bot`. It starts long polling in `onModuleInit` (deliberately **not awaited** — `bot.start()` only resolves when the bot stops, so awaiting would block bootstrap) and calls `bot.stop()` in `onModuleDestroy`. Handlers: `command('start')`, `command('balance')` (shows coin balance), `on('message:contact')` (registration), `on('message:voice')` (registration-gated; echoes the voice + priced action buttons), and `callbackQuery('transcribe'|'summarize')` which does the work with live caption updates. The callback reads the audio's `file_id` off the message the button is attached to (so nothing needs to be packed into `callback_data`), and gates/charges via `BillingService`. The two action buttons are stacked **one per row** (`.row()`). All reply text lives in `src/bot/messages.ts` (Uzbek). **Parse-mode convention:** chrome messages use `<b>` and are sent with `parse_mode: 'HTML'`; the transcription/summary **result** caption and the `insufficientCoins` **alert** must stay PLAIN (user content can contain `<`/`&`; callback alerts ignore markup). `setCaption(..., html=false)` sends the result plain.
- `src/users/` — `User` entity (table `users`, includes a `coins` int balance defaulting to 0) + `UsersService` (TypeORM repository). Runs against a dedicated `voice_vault` database, so `synchronize` is safe. Telegram IDs are stored as a `bigint` column and surface as **strings**, so `UsersService` converts with `String(id)` on every query/insert.
- `src/transcripts/` — `Transcript` entity (table `transcripts`) + `TranscriptsService`. Belongs to a `User` via `@ManyToOne` (`user_id` FK → `users.id`, `onDelete: CASCADE`); composite-unique on `(user, file_unique_id)`. One row per voice holds its `text` (transcription) and/or `summary`, both nullable. `saveTranscription()`/`saveSummary()` upsert onto the same row (preserving the other field), so the two caches coexist and never duplicate. Service methods take a `User` entity (not a telegram id).
- `src/ai/` — `TranscriptionService` wraps the `@google/genai` SDK. Gemini accepts audio inline (base64), so Telegram's OGG/Opus voice notes go straight through with no audio conversion step. Operations: `transcribe()` (verbatim, via a private `analyze()` helper) and `transcribeAndSummarize()` (one call returning **both** transcript and summary, for the summarize-from-audio path) use **structured JSON output** (`responseSchema`) with a `uzbek | russian | other` language enum; `summarizeText()` summarizes already-transcribed text (plain text in/out, for the DB-cached summarize path). **Both are restricted to Uzbek and Russian and never translate** (transcription is verbatim; summaries stay in the original language). Any other language comes back as `language: 'other'`, and `BotService` shows an "unsupported" message instead of a result. To change the allowed set, edit the enum + prompts in `TranscriptionService` and the rejection check in `BotService`.
- `src/storage/` — `StorageService` writes voice files to `uploads/voice/` (relative to `process.cwd()`), named `<timestamp>_<file_unique_id><ext>`. The directory is created on boot (`onModuleInit`) and again before each write. A save failure is logged but does **not** block transcription. The `uploads/voice/` files are gitignored (the folder is kept via `.gitkeep`).
- `src/billing/` — `CoinTransaction` entity (table `coin_transactions`, `@ManyToOne` → `User`, `onDelete: CASCADE`) + `BillingService`. `credit()` (admin) and `charge()` (usage) both go through a private `apply()` that runs in a DB transaction with a **pessimistic write lock** on the user row (so concurrent charges can't overspend), updates `user.coins`, and appends a signed ledger entry with `balanceAfter`. `charge()` throws `InsufficientCoinsError` if the balance would go negative.
- `src/auth/` — admin auth. `AuthService.login()` checks `ADMIN_LOGIN`/`ADMIN_PASSWORD` from env and signs a JWT (`@nestjs/jwt`, 1d expiry). `JwtAuthGuard` verifies the `Bearer` token; it's exported (with `JwtModule`) so `AdminModule` can apply it.
- `src/admin/` — the protected REST controllers (`UsersController`, `StatsController`, `TransactionsController`), all `@UseGuards(JwtAuthGuard)`. They compose `UsersService`, `TranscriptsService`, and `BillingService`; per-user counts come from `TranscriptsService.statsByUser()`, the global ledger from `BillingService.listAll()`. DTOs (`class-validator`) live in `src/admin/dto`.

When adding features, prefer `nest generate module|service <name>` (CLI is installed) so wiring stays consistent. Note there are no controllers — adding HTTP routes would require switching `main.ts` back to `NestFactory.create` and re-adding `@nestjs/platform-express`.

## Conventions / gotchas

- **TypeScript module system is `nodenext`** (`tsconfig.json`). Relative imports resolve under Node's ESM rules — keep extensions/paths consistent with how the CLI scaffolds them. `strictNullChecks` is on, but `noImplicitAny` is off.
- ESLint uses the **type-checked** typescript-eslint config (`recommendedTypeChecked`), so lint requires a valid `tsconfig` project. Notable rule deviations (`eslint.config.mjs`): `no-explicit-any` is off; `no-floating-promises` and `no-unsafe-argument` are warnings, not errors; Prettier violations are errors with `endOfLine: "auto"`.
- Prettier (`.prettierrc`): single quotes, trailing commas. `npm run format` / `npm run lint` apply it.
