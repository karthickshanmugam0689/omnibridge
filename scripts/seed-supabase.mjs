#!/usr/bin/env node
/**
 * Seed the production Supabase `posts` table with the same rich, pre-translated
 * sample data that `src/lib/sampleData.ts` uses locally.
 *
 * Idempotent: we tag every seed row with `author_client_id = "seed-v1"` and
 * skip the insert if any rows with that tag already exist.
 *
 * Run:   node scripts/seed-supabase.mjs
 * Needs: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (or .env).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ── Load .env so we don't need separate export ──────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
try {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch {
  // no .env — fall through; env vars might be set directly
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Posts are spread over the last ~2 days to look natural in the feed.
const HOUR = 60 * 60 * 1000;
const isoMinus = (ms) => new Date(Date.now() - ms).toISOString();

const SEED_TAG = "seed-v1";

const POSTS = [
  // ── Pinned community resources (translations pre-filled) ──────────────────
  {
    author_name: "Liga za ľudské práva",
    author_emoji: "⚖️",
    category: "legal",
    title_sk: "Bezplatná právna pomoc pre utečencov",
    title_translations: {
      en: "Free legal aid for refugees",
      ar: "مساعدة قانونية مجانية للاجئين",
      uk: "Безкоштовна правова допомога для біженців",
    },
    body_sk:
      "Poradenstvo k azylu, pobytu a zamestnaniu. Po–Pi 9:00–16:00. Tel: 055 123 4567.",
    body_translations: {
      en: "Asylum, residency and employment advice. Mon–Fri 9:00–16:00. Phone 055 123 4567.",
      ar: "استشارات حول اللجوء والإقامة والعمل. الإثنين–الجمعة 9:00–16:00. هاتف 055 123 4567.",
      uk: "Консультації з питань притулку, проживання та працевлаштування. Пн–Пт 9:00–16:00. Тел. 055 123 4567.",
    },
    is_resource: true,
    last_status: "Otvorené teraz",
    location: "Hlavná 68, Košice",
    created_at: isoMinus(HOUR * 36),
  },
  {
    author_name: "Komunitná chladnička Mlynská",
    author_emoji: "🍎",
    category: "food",
    title_sk: "Voľná chladnička — vezmi si, čo potrebuješ",
    title_translations: {
      en: "Free community fridge — take what you need",
      ar: "ثلاجة مجتمعية مجانية — خذ ما تحتاج",
      uk: "Безкоштовний громадський холодильник — беріть, що потрібно",
    },
    body_sk:
      "Denne dopĺňané pečivo, ovocie a zelenina. K dispozícii 24/7 pri vchode do kaviarne.",
    body_translations: {
      en: "Bread, fruit and vegetables restocked daily. Available 24/7 at the café entrance.",
      ar: "خبز وفواكه وخضروات يُعاد تعبئتها يوميًا. متاحة على مدار الساعة عند مدخل المقهى.",
      uk: "Хліб, овочі та фрукти поповнюються щодня. Доступно цілодобово біля входу в кав'ярню.",
    },
    is_resource: true,
    last_status: "Doplnené dnes ráno",
    location: "Mlynská 15, Košice",
    created_at: isoMinus(HOUR * 34),
  },
  {
    author_name: "Komunitná kuchyňa Dominikánske nám.",
    author_emoji: "🍲",
    category: "food",
    title_sk: "Teplé jedlo zadarmo — každý deň o 12:00",
    title_translations: {
      en: "Free hot meal — every day at 12:00",
      ar: "وجبة ساخنة مجانية — يوميًا الساعة 12:00",
      uk: "Безкоштовний гарячий обід — щодня о 12:00",
    },
    body_sk:
      "Polievka a hlavné jedlo. Žiadna registrácia. Pomoc s prekladom je k dispozícii.",
    body_translations: {
      en: "Soup and main course. No registration needed. Translator available on site.",
      ar: "شوربة وطبق رئيسي. بدون تسجيل. يوجد مترجم في المكان.",
      uk: "Суп і основна страва. Без реєстрації. На місці є перекладач.",
    },
    is_resource: true,
    last_status: "Otvorené 11:30–13:30",
    location: "Dominikánske námestie 2, Košice",
    created_at: isoMinus(HOUR * 32),
  },
  {
    author_name: "Charita sv. Alžbety",
    author_emoji: "👕",
    category: "resource",
    title_sk: "Šatník zdarma — oblečenie a topánky",
    title_translations: {
      en: "Free clothing bank — clothes and shoes",
      ar: "بنك ملابس مجاني — ملابس وأحذية",
      uk: "Безкоштовний магазин одягу — одяг і взуття",
    },
    body_sk: "Dospelí aj deti, všetky veľkosti. Ut a Št 10:00–17:00.",
    body_translations: {
      en: "Adults and children, all sizes. Tue and Thu 10:00–17:00.",
      ar: "للبالغين والأطفال، جميع المقاسات. الثلاثاء والخميس 10:00–17:00.",
      uk: "Для дорослих і дітей, усі розміри. Вт і Чт 10:00–17:00.",
    },
    is_resource: true,
    last_status: "Otvorené dnes",
    location: "Bočná 2, Košice",
    created_at: isoMinus(HOUR * 30),
  },
  {
    author_name: "Knižnica J. Bocatia",
    author_emoji: "🌐",
    category: "resource",
    title_sk: "Bezplatné WiFi a počítače pre verejnosť",
    title_translations: {
      en: "Free WiFi and computers for the public",
      ar: "واي فاي وحواسيب مجانية للجمهور",
      uk: "Безкоштовний Wi-Fi і комп'ютери для громадськості",
    },
    body_sk:
      "Pokojné prostredie, pomoc s úradnými formulármi. Po–So 9:00–18:00.",
    body_translations: {
      en: "Quiet space, help with official forms. Mon–Sat 9:00–18:00.",
      ar: "مكان هادئ، مساعدة في النماذج الرسمية. الإثنين–السبت 9:00–18:00.",
      uk: "Тихе місце, допомога з офіційними документами. Пн–Сб 9:00–18:00.",
    },
    is_resource: true,
    last_status: "Otvorené teraz",
    location: "Hviezdoslavova 5, Košice",
    created_at: isoMinus(HOUR * 28),
  },
  {
    author_name: "Ambulancia bez poistky",
    author_emoji: "🏥",
    category: "medical",
    title_sk: "Bezplatné lekárske vyšetrenie bez poistenia",
    title_translations: {
      en: "Free medical check-up for uninsured patients",
      ar: "فحص طبي مجاني لغير المؤمَّنين",
      uk: "Безкоштовний медичний огляд без страховки",
    },
    body_sk:
      "Praktický lekár, základné vyšetrenia. Str 14:00–18:00. Vopred zavolať: 0910 555 222.",
    body_translations: {
      en: "GP visit and basic tests. Wed 14:00–18:00. Call ahead: 0910 555 222.",
      ar: "زيارة طبيب عام وفحوصات أساسية. الأربعاء 14:00–18:00. اتصل مسبقًا: 0910 555 222.",
      uk: "Сімейний лікар, базові аналізи. Ср 14:00–18:00. Телефонуйте заздалегідь: 0910 555 222.",
    },
    is_resource: true,
    last_status: "Str 14:00–18:00",
    location: "Trieda SNP 1, Košice",
    created_at: isoMinus(HOUR * 26),
  },

  // ── Recent posts from neighbours ───────────────────────────────────────────
  {
    author_name: "Mária",
    author_emoji: "🌻",
    category: "help",
    title_sk: "Potrebujem kúpiť chlieb a mlieko, neviem chodiť",
    title_translations: {
      en: "I need someone to buy bread and milk — I can't walk",
      ar: "أحتاج من يشتري لي الخبز والحليب — لا أستطيع المشي",
      uk: "Потрібна допомога купити хліб і молоко — я не можу ходити",
    },
    body_sk: "Bývam na Terase, bolí ma bedro. Zaplatím. Ďakujem.",
    body_translations: {
      en: "I live in Terasa, my hip hurts. I'll pay for the shopping. Thank you.",
      ar: "أسكن في حي تيراسا، ورِكي يؤلمني. سأدفع ثمن المشتريات. شكرًا.",
      uk: "Живу в районі Тераса, болить стегно. Гроші за покупки віддам. Дякую.",
    },
    is_resource: false,
    location: "Terasa, Košice",
    created_at: isoMinus(HOUR * 1),
  },
  {
    author_name: "Ahmad",
    author_emoji: "🦊",
    category: "ride",
    title_sk: "Hľadám odvoz zo stanice na ubytovňu na Jahodnej",
    title_translations: {
      en: "Looking for a ride from the train station to the dorm on Jahodná",
      ar: "أبحث عن توصيلة من محطة القطار إلى السكن في شارع ياهودنا",
      uk: "Шукаю підвезення з вокзалу до гуртожитку на вулиці Яходна",
    },
    body_sk: "Zajtra ráno o 8:00. Mám dve tašky. Ďakujem.",
    body_translations: {
      en: "Tomorrow morning at 8:00. I have two bags. Thank you.",
      ar: "غدًا صباحًا الساعة 8:00. معي حقيبتان. شكرًا.",
      uk: "Завтра вранці о 8:00. У мене дві сумки. Дякую.",
    },
    is_resource: false,
    location: "Železničná stanica Košice",
    created_at: isoMinus(HOUR * 2.5),
  },
  {
    author_name: "Peter",
    author_emoji: "🚗",
    category: "ride",
    title_sk: "Ponúkam odvoz Košice — Prešov v piatok",
    title_translations: {
      en: "Offering a ride Košice — Prešov on Friday",
      ar: "أعرض توصيلة من كوشيتسه إلى بريشوف يوم الجمعة",
      uk: "Пропоную підвезення Кошиці — Пряшів у п'ятницю",
    },
    body_sk: "Odchod 15:30 z Moldavskej. Dve miesta voľné, zdarma.",
    body_translations: {
      en: "Leaving 15:30 from Moldavská. Two free seats, no charge.",
      ar: "المغادرة الساعة 15:30 من شارع مولدافسكا. مقعدان شاغران، مجانًا.",
      uk: "Виїзд о 15:30 з вулиці Молдавська. Два вільні місця, безкоштовно.",
    },
    is_resource: false,
    location: "Moldavská cesta, Košice",
    created_at: isoMinus(HOUR * 4),
  },
  {
    author_name: "Jana",
    author_emoji: "🌳",
    category: "food",
    title_sk: "Mám prebytok jabĺk zo záhrady — vezmite si",
    title_translations: {
      en: "I have a surplus of apples from my garden — come take some",
      ar: "عندي فائض من التفاح من حديقتي — تفضّلوا وخذوا منه",
      uk: "Маю надлишок яблук із саду — приходьте і беріть",
    },
    body_sk: "2 prepravky, ešte dnes, Sídlisko Furča. Zazvoňte a vynesiem.",
    body_translations: {
      en: "Two crates, today only, Furča estate. Ring the bell and I'll bring them out.",
      ar: "صندوقان، اليوم فقط، حي فورتشا. اضغط الجرس وسأخرجهما.",
      uk: "Дві ящики, тільки сьогодні, район Фурча. Подзвоніть — винесу.",
    },
    is_resource: false,
    location: "Furča, Košice",
    created_at: isoMinus(HOUR * 6),
  },
  {
    author_name: "Lucia",
    author_emoji: "🦉",
    category: "tech",
    title_sk: "Pokazený Wi-Fi router, kto by pomohol?",
    title_translations: {
      en: "Broken Wi-Fi router — can anyone help?",
      ar: "جهاز راوتر واي فاي معطّل — من يستطيع المساعدة؟",
      uk: "Зламаний Wi-Fi роутер — хто б допоміг?",
    },
    body_sk: "Staršia pani, býva v KVP. Stačí pol hodiny práce.",
    body_translations: {
      en: "For an elderly lady living in KVP. Half an hour of work should be enough.",
      ar: "لسيدة مسنّة تسكن في حي KVP. نصف ساعة من العمل يكفي.",
      uk: "Для літньої пані, живе в районі KVP. Вистачить півгодини роботи.",
    },
    is_resource: false,
    location: "KVP, Košice",
    created_at: isoMinus(HOUR * 8),
  },
  {
    author_name: "Tomáš",
    author_emoji: "🐻",
    category: "help",
    title_sk: "Pomôžem s nákupom starším susedom každú sobotu",
    title_translations: {
      en: "I'll help elderly neighbours with shopping every Saturday",
      ar: "أساعد الجيران المسنين في التسوّق كل يوم سبت",
      uk: "Допомагатиму літнім сусідам із покупками щосуботи",
    },
    body_sk: "Bývam v centre, mám auto. Napíšte mi.",
    body_translations: {
      en: "I live in the centre and have a car. Send me a message.",
      ar: "أسكن في وسط المدينة ولديّ سيارة. راسلوني.",
      uk: "Живу в центрі, маю авто. Напишіть мені.",
    },
    is_resource: false,
    location: "Staré mesto, Košice",
    created_at: isoMinus(HOUR * 11),
  },
  {
    author_name: "Olena",
    author_emoji: "⭐",
    category: "medical",
    title_sk: "Hľadám detského lekára, ktorý hovorí po ukrajinsky",
    title_translations: {
      en: "Looking for a paediatrician who speaks Ukrainian",
      ar: "أبحث عن طبيب أطفال يتحدث الأوكرانية",
      uk: "Шукаю педіатра, який говорить українською",
    },
    body_sk: "Dcéra (4) má kašeľ. Ďakujem za každý tip.",
    body_translations: {
      en: "My daughter (4) has a cough. Any tip is appreciated.",
      ar: "ابنتي (4 سنوات) تعاني من السعال. أي نصيحة مفيدة.",
      uk: "Донька (4 роки) кашляє. Буду вдячна за будь-яку пораду.",
    },
    is_resource: false,
    location: "Sídlisko Nad jazerom, Košice",
    created_at: isoMinus(HOUR * 14),
  },
  {
    author_name: "Martin",
    author_emoji: "🐝",
    category: "legal",
    title_sk: "Kde môžem získať potvrdenie o pobyte pre zamestnanie?",
    title_translations: {
      en: "Where can I get a proof-of-residence document for a new job?",
      ar: "أين يمكنني الحصول على إثبات إقامة لوظيفة جديدة؟",
      uk: "Де можна отримати довідку про проживання для роботи?",
    },
    body_sk: "Som tu 2 mesiace, potrebujem to pre nového zamestnávateľa.",
    body_translations: {
      en: "I've been here 2 months, I need it for my new employer.",
      ar: "أنا هنا منذ شهرين، أحتاجها لصاحب العمل الجديد.",
      uk: "Я тут вже 2 місяці, це потрібно для нового роботодавця.",
    },
    is_resource: false,
    location: "Košice",
    created_at: isoMinus(HOUR * 18),
  },
  {
    author_name: "Eva",
    author_emoji: "🫖",
    category: "resource",
    title_sk: "Darujem detskú postieľku a kočík",
    title_translations: {
      en: "Giving away a baby cot and a pushchair",
      ar: "أقدّم سرير أطفال وعربة أطفال مجانًا",
      uk: "Віддам дитяче ліжечко та візочок",
    },
    body_sk: "Zachovalé, len vyzdvihnúť. Juh, pri Luníku IX.",
    body_translations: {
      en: "In good condition — pickup only. Juh district, near Luník IX.",
      ar: "بحالة جيدة — للاستلام فقط. حي يوه بالقرب من لونيك 9.",
      uk: "У хорошому стані — тільки самовивіз. Район Юг, біля Лунік IX.",
    },
    is_resource: false,
    location: "Juh, Košice",
    created_at: isoMinus(HOUR * 22),
  },
];

// Supabase REST requires every object in a bulk insert to have *exactly* the
// same set of keys (PGRST102). We normalize by filling missing optional
// fields with null so neighbour-posts and resource-posts share a schema.
const rows = POSTS.map((p) => ({
  author_name: p.author_name,
  author_emoji: p.author_emoji,
  author_client_id: SEED_TAG,
  category: p.category,
  title_sk: p.title_sk,
  title_translations: p.title_translations ?? null,
  body_sk: p.body_sk ?? null,
  body_translations: p.body_translations ?? null,
  source_lang: "sk",
  is_resource: Boolean(p.is_resource),
  last_status: p.last_status ?? null,
  location: p.location ?? null,
  created_at: p.created_at,
}));

const headers = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// ── Helper profiles ──────────────────────────────────────────────────────
// Two demo neighbours who've opted into "I can help". They're wide open on
// weekday mornings + afternoons so the match engine will pick them up for
// any post in their categories during a typical demo window.
//
// NB: These `client_id` values are deliberately NOT UUIDs — they're tagged
// with a `seed-helper-` prefix so we can re-run this script idempotently
// (delete-then-insert) without stomping a real user's profile.
const HELPERS = [
  {
    client_id: "seed-helper-tomas",
    name: "Tomáš",
    emoji: "🐻",
    preferred_lang: "sk",
    helper_tags: ["help", "ride"],
    availability: {
      mon: ["morning", "afternoon"],
      tue: ["morning", "afternoon"],
      wed: ["morning", "afternoon"],
      thu: ["morning", "afternoon"],
      fri: ["morning", "afternoon"],
      sat: ["morning"],
      sun: ["morning"],
    },
    helper_enabled: true,
    // Starter points so the Settings "thank-you" card isn't empty during
    // the demo. Real rewards come from /api/resolve +10 per thank-you.
    points: 30,
  },
  {
    client_id: "seed-helper-jana",
    name: "Jana",
    emoji: "🌳",
    preferred_lang: "en",
    helper_tags: ["help", "food", "tech"],
    availability: {
      mon: ["morning", "afternoon", "evening"],
      tue: ["morning", "afternoon", "evening"],
      wed: ["morning", "afternoon", "evening"],
      thu: ["morning", "afternoon", "evening"],
      fri: ["morning", "afternoon", "evening"],
      sat: ["morning", "afternoon"],
      sun: ["morning", "afternoon"],
    },
    helper_enabled: true,
    points: 50,
  },
];

async function main() {
  // 1. Idempotency check — count existing seed rows.
  const existsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/posts?author_client_id=eq.${SEED_TAG}&select=id`,
    { headers },
  );
  if (!existsRes.ok) {
    console.error("Probe failed:", existsRes.status, await existsRes.text());
    process.exit(1);
  }
  const existing = await existsRes.json();
  if (existing.length > 0) {
    console.log(
      `Seed already present (${existing.length} rows). Deleting before reinserting…`,
    );
    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?author_client_id=eq.${SEED_TAG}`,
      { method: "DELETE", headers },
    );
    if (!delRes.ok) {
      console.error("Delete failed:", delRes.status, await delRes.text());
      process.exit(1);
    }
  }

  // 2. Insert in a single batch — Supabase handles arrays natively.
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
  });
  if (!insRes.ok) {
    console.error("Insert failed:", insRes.status, await insRes.text());
    process.exit(1);
  }
  const inserted = await insRes.json();
  console.log(`✔ Seeded ${inserted.length} posts into Supabase.`);

  // 3. Upsert helper profiles (idempotent via on_conflict=client_id).
  //    If the `profiles` table doesn't exist yet (migration not run) we log
  //    a friendly hint instead of failing the whole seed.
  const profileHeaders = { ...headers, Prefer: "resolution=merge-duplicates" };
  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?on_conflict=client_id`,
    {
      method: "POST",
      headers: profileHeaders,
      body: JSON.stringify(HELPERS),
    },
  );
  if (!profRes.ok) {
    const msg = await profRes.text();
    if (profRes.status === 404 || /relation .*profiles/i.test(msg)) {
      console.warn(
        "⚠ `profiles` table not found — run supabase/migrate-v2.sql first.",
      );
    } else {
      console.error("Helper upsert failed:", profRes.status, msg);
    }
  } else {
    console.log(`✔ Seeded ${HELPERS.length} helper profiles.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
