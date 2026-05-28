/**
 * All user-facing bot text, in Uzbek.
 *
 * Chrome messages use HTML markup (`<b>`), so they must be sent with
 * `parse_mode: 'HTML'`. Exceptions that must stay PLAIN: transcription/summary
 * result text (user content) and `insufficientCoins` (shown as a callback
 * alert, which ignores markup). Inline button labels are always plain.
 */

export const PHONE_BUTTON = '📱 Telefon raqamni ulashish';

function formatDate(d: Date): string {
  const months = [
    'yan', 'fev', 'mar', 'apr', 'may', 'iyn',
    'iyl', 'avg', 'sen', 'okt', 'noy', 'dek',
  ];
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]}, ${h}:${m}`;
}

/** Render a coin cost for a button label (0 => "free"). */
const price = (cost: number): string => (cost === 0 ? 'bepul' : `${cost} 💎`);

export const messages = {
  welcome: (name: string) =>
    `👋 <b>Assalomu alaykum, ${name}!</b>\n\n` +
    '🎙 Menga <b>ovozli xabar</b> yuboring — uni matnga aylantirib yoki ' +
    'qisqacha mazmunini tayyorlab beraman.\n' +
    "🌐 Tillar: <b>o'zbek</b> va <b>rus</b>.\n\n" +
    '<b>📋 Buyruqlar:</b>\n' +
    '▫️ /start — botni ishga tushirish\n' +
    "▫️ /balance — 💎 balansni ko'rish\n" +
    "▫️ /history — 📚 tarixni ko'rish",

  askPhone:
    '👋 <b>Assalomu alaykum!</b>\n\n' +
    '🎙 Men ovozli xabarlarni matnga aylantiraman va qisqacha mazmun ' +
    'tayyorlayman.\n' +
    '📱 Boshlash uchun pastdagi tugma orqali <b>telefon raqamingizni</b> ' +
    'ulashing.',

  registered: (name: string) =>
    `✅ <b>Rahmat, ${name}!</b> Ro'yxatdan o'tdingiz.\n\n` +
    '🎙 Endi menga <b>ovozli xabar</b> yuborishingiz mumkin.\n' +
    '💎 Balansni /balance orqali tekshiring.',

  shareOwnPhone:
    "⚠️ Iltimos, faqat <b>o'zingizning</b> telefon raqamingizni ulashing.",

  notRegistered:
    "🔒 Ovozli xabarni qayta ishlash uchun avval <b>ro'yxatdan o'ting</b>.\n" +
    '📱 Pastdagi tugma orqali telefon raqamingizni ulashing.',

  // Action selection (caption on the echoed voice message)
  chooseAction: '🎧 <b>Ovozli xabar bilan nima qilay?</b>',
  btnTranscribe: (cost: number) => `📝 Matnga aylantirish · ${price(cost)}`,
  btnSummarize: (cost: number) => `📋 Qisqacha mazmun · ${price(cost)}`,

  // In-progress captions
  transcribing: '✍️ <b>Matnga aylantirilmoqda…</b>',
  summarizing: '🧠 <b>Qisqacha mazmun tayyorlanmoqda…</b>',

  // Results / errors (chrome — HTML)
  resultBelow: '✅ <b>Tayyor!</b> Natija quyida 👇',
  unsupportedLanguage:
    "⚠️ Faqat <b>o'zbek</b> va <b>rus</b> tilidagi ovozli xabarlar " +
    "qo'llab-quvvatlanadi.",
  noSpeech: '🤔 Nutq aniqlanmadi.',
  processError: '😕 Kechirasiz, ushbu xabarni qayta ishlay olmadim.',
  fileError: '😕 Ushbu ovozli xabarni ololmadim.',

  // Shown as a callback alert — PLAIN text (alerts ignore markup)
  insufficientCoins: (balance: number, cost: number) =>
    'Hisobingizda 💎 yetarli emas.\n' +
    `Kerak: ${cost} 💎, mavjud: ${balance} 💎.\n` +
    "💎 to'ldirish uchun administrator bilan bog'laning.",

  balance: (coins: number) => `💰 <b>Balans:</b> ${coins} 💎`,

  coinsAdded: (amount: number, balance: number) =>
    `🎉 Hisobingizga <b>${amount} 💎</b> qo'shildi!\n` +
    `Yangi balans: <b>${balance} 💎</b>`,

  // History list
  historyEmpty: '📭 Hali birorta ovozli xabar qayta ishlanmagan.',
  historyHeader: (page: number, totalPages: number) =>
    `📚 <b>Tarix</b> — ${page}/${totalPages} sahifa`,
  historyEntry: (
    n: number,
    date: Date,
    lang: string,
    hasText: boolean,
    hasSummary: boolean,
  ) => {
    const langIcon =
      lang === 'uzbek' ? '🇺🇿' : lang === 'russian' ? '🇷🇺' : '';
    const content = [hasText && '📝', hasSummary && '📋']
      .filter(Boolean)
      .join(' ');
    const meta = [langIcon, content || '—'].filter(Boolean).join(' · ');
    return `${n}. ${formatDate(date)} · ${meta}`;
  },
  historyBtnView: (n: number) => `👁 ${n}`,
  historyBtnPrev: '⬅️ Oldingi',
  historyBtnNext: 'Keyingi ➡️',

  // History detail view
  historyDetailHeader: (date: Date) => `📄 <b>${formatDate(date)}</b>`,
  historyDetailText: (text: string) => `\n\n📝 <b>Matn:</b>\n${text}`,
  historyDetailSummary: (summary: string) => `\n\n📋 <b>Xulosa:</b>\n${summary}`,
  historyDetailEmpty: "❌ Bu yozuv uchun mazmun yo'q.",
  historyBtnBack: '⬅️ Orqaga',
  historyNotFound: '😕 Yozuv topilmadi.',
};
