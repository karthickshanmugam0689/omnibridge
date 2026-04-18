-- OmniBridge seed data for the Košice community.
-- Mix of pinned resources (is_resource = true) and recent help/offer posts.
-- Translations are intentionally filled for the pinned resources so the
-- multilingual UI has something rich to show without running Gemini.

insert into posts (
  author_name, author_emoji, category, title_sk, title_translations,
  body_sk, body_translations, is_resource, last_status, location
) values
-- ── Pinned resources ────────────────────────────────────────────────────────
(
  'Liga za ľudské práva', '⚖️', 'legal',
  'Bezplatná právna pomoc pre utečencov',
  jsonb_build_object(
    'en', 'Free legal aid for refugees',
    'ar', 'مساعدة قانونية مجانية للاجئين',
    'uk', 'Безкоштовна правова допомога для біженців'
  ),
  'Poradenstvo k azylu, pobytu a zamestnaniu. Po–Pi 9:00–16:00. Tel: 055 123 4567.',
  jsonb_build_object(
    'en', 'Asylum, residency and employment advice. Mon–Fri 9–16. Phone 055 123 4567.',
    'ar', 'استشارات حول اللجوء والإقامة والعمل. الإثنين–الجمعة 9–16. هاتف 055 123 4567.',
    'uk', 'Консультації з питань притулку, проживання та працевлаштування. Пн–Пт 9:00–16:00. Тел. 055 123 4567.'
  ),
  true, 'Otvorené teraz', 'Hlavná 68, Košice'
),
(
  'Komunitná chladnička Mlynská', '🍎', 'food',
  'Voľná chladnička — vezmi si, čo potrebuješ',
  jsonb_build_object(
    'en', 'Free community fridge — take what you need',
    'ar', 'ثلاجة مجتمعية مجانية — خذ ما تحتاج',
    'uk', 'Безкоштовний громадський холодильник — беріть, що потрібно'
  ),
  'Denne dopĺňané pečivo, ovocie a zelenina. K dispozícii 24/7 pri vchode do kaviarne.',
  jsonb_build_object(
    'en', 'Bread, fruit and vegetables restocked daily. Available 24/7 at the café entrance.',
    'ar', 'خبز وفواكه وخضروات يُعاد تعبئتها يوميًا. متاحة 24/7 عند مدخل المقهى.',
    'uk', 'Хліб, овочі та фрукти поповнюються щодня. Доступно цілодобово біля входу в кав''ярню.'
  ),
  true, 'Doplnené dnes ráno', 'Mlynská 15, Košice'
),
(
  'Komunitná kuchyňa Dominikánske nám.', '🍲', 'food',
  'Teplé jedlo zadarmo — každý deň o 12:00',
  jsonb_build_object(
    'en', 'Free hot meal — every day at 12:00',
    'ar', 'وجبة ساخنة مجانية — يوميًا الساعة 12:00',
    'uk', 'Безкоштовний гарячий обід — щодня о 12:00'
  ),
  'Polievka a hlavné jedlo. Žiadna registrácia. Pomoc s prekladom je k dispozícii.',
  jsonb_build_object(
    'en', 'Soup and main course. No registration needed. Translator on site.',
    'ar', 'شوربة وطبق رئيسي. بدون تسجيل. يوجد مترجم.',
    'uk', 'Суп і основна страва. Без реєстрації. На місці є перекладач.'
  ),
  true, 'Otvorené 11:30–13:30', 'Dominikánske námestie 2, Košice'
),
(
  'Charita sv. Alžbety', '👕', 'resource',
  'Šatník zdarma — oblečenie a topánky',
  jsonb_build_object(
    'en', 'Free clothing bank — clothes and shoes',
    'ar', 'بنك ملابس مجاني — ملابس وأحذية',
    'uk', 'Безкоштовний магазин одягу — одяг та взуття'
  ),
  'Dospelí aj deti, všetky veľkosti. Ut a Št 10:00–17:00.',
  jsonb_build_object(
    'en', 'Adults and children, all sizes. Tue and Thu 10:00–17:00.',
    'ar', 'للبالغين والأطفال، جميع المقاسات. الثلاثاء والخميس 10:00–17:00.',
    'uk', 'Для дорослих і дітей, усі розміри. Вт і Чт 10:00–17:00.'
  ),
  true, 'Otvorené dnes', 'Bočná 2, Košice'
),
(
  'WiFi zóna Knižnica J. Bocatia', '🌐', 'resource',
  'Bezplatné WiFi a počítače pre verejnosť',
  jsonb_build_object(
    'en', 'Free WiFi and computers for the public',
    'ar', 'واي فاي وحواسيب مجانية للجمهور',
    'uk', 'Безкоштовний Wi-Fi і комп''ютери для громадськості'
  ),
  'Pokojné prostredie, pomoc s úradnými formulármi. Po–So 9:00–18:00.',
  jsonb_build_object(
    'en', 'Quiet space, help with official forms. Mon–Sat 9:00–18:00.',
    'ar', 'مكان هادئ، مساعدة في النماذج الرسمية. الإثنين–السبت 9:00–18:00.',
    'uk', 'Тихе місце, допомога з офіційними документами. Пн–Сб 9:00–18:00.'
  ),
  true, 'Otvorené teraz', 'Hviezdoslavova 5, Košice'
),
(
  'Ambulancia bez poistky', '🏥', 'medical',
  'Bezplatné lekárske vyšetrenie bez poistenia',
  jsonb_build_object(
    'en', 'Free medical check-up for uninsured patients',
    'ar', 'فحص طبي مجاني لغير المؤمَّنين',
    'uk', 'Безкоштовний медичний огляд без страховки'
  ),
  'Praktický lekár, základné vyšetrenia. Str 14:00–18:00. Vopred zavolať: 0910 555 222.',
  jsonb_build_object(
    'en', 'GP visit and basic tests. Wed 14:00–18:00. Call ahead: 0910 555 222.',
    'ar', 'زيارة طبيب عام وفحوصات أساسية. الأربعاء 14:00–18:00. اتصل مسبقًا: 0910 555 222.',
    'uk', 'Сімейний лікар, базові аналізи. Ср 14:00–18:00. Телефонуйте заздалегідь: 0910 555 222.'
  ),
  true, 'Str 14:00–18:00', 'Trieda SNP 1, Košice'
),

-- ── Recent posts from neighbours ────────────────────────────────────────────
(
  'Mária', '🌻', 'help', 'Potrebujem kúpiť chlieb a mlieko, neviem chodiť',
  null,
  'Bývam na Terase, bolí ma bedro. Zaplatím. Ďakujem.',
  null,
  false, null, 'Terasa, Košice'
),
(
  'Ahmad', '🦊', 'ride', 'Hľadám odvoz zo stanice na ubytovňu na Jahodnej',
  null,
  'Zajtra ráno o 8:00. Mám dve tašky. Ďakujem.',
  null,
  false, null, 'Železničná stanica Košice'
),
(
  'Peter', '🚗', 'ride', 'Ponúkam odvoz Košice — Prešov v piatok',
  null,
  'Odchod 15:30 z Moldavskej. Dve miesta voľné, zdarma.',
  null,
  false, null, 'Moldavská cesta'
),
(
  'Jana', '🌳', 'food', 'Mám prebytok jabĺk zo záhrady — vezmite si',
  null,
  '2 prepravky, ešte dnes, Sídlisko Furča. Zazvoňte a vynesiem.',
  null,
  false, null, 'Furča, Košice'
),
(
  'Lucia', '🦉', 'tech', 'Pokazený Wi-Fi router, kto by pomohol?',
  null,
  'Staršia pani, býva v KVP. Stačí pol hodiny práce.',
  null,
  false, null, 'KVP, Košice'
),
(
  'Tomáš', '🐻', 'help', 'Pomôžem s nákupom starším susedom každú sobotu',
  null,
  'Bývam v centre, mám auto. Napíšte mi.',
  null,
  false, null, 'Staré mesto, Košice'
),
(
  'Olena', '⭐', 'medical', 'Hľadám detského lekára, ktorý hovorí po ukrajinsky',
  null,
  'Dcéra (4) má kašeľ. Ďakujem za každý tip.',
  null,
  false, null, 'Sídlisko Nad jazerom'
),
(
  'Martin', '🐝', 'legal', 'Kde môžem získať potvrdenie o pobyte pre zamestnanie?',
  null,
  'Som tu 2 mesiace, potrebujem to pre nového zamestnávateľa.',
  null,
  false, null, 'Košice'
),
(
  'Eva', '🫖', 'resource', 'Darujem detskú postieľku a kočík',
  null,
  'Zachovalé, len vyzdvihnúť. Juh, pri Luníku IX.',
  null,
  false, null, 'Juh, Košice'
);
