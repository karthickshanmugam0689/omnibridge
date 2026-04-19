import i18n from "@/i18n";
import type { Category } from "./types";
import { CATEGORIES } from "./types";

/**
 * Offline-first heuristic that guesses a category from a free-text query.
 *
 * Strategy:
 *   1. Score each category by how many of its keyword cues appear in the query.
 *   2. Also check the localised category label itself (from i18next) so
 *      "jedlo", "food", "طعام", "їжа" all map to `food`.
 *   3. Fall back to `help` when nothing hits — this is the most generic
 *      bucket and matches the product's default ask-for-help flow.
 *
 * Deliberately no LLM call: this runs offline, instantly, and is good
 * enough for pre-filling a category the user can still change with one tap.
 */

const CATEGORY_CUES: Record<Category, string[]> = {
  help: [
    "help", "pomoc", "pomôcť", "nakúp", "shopping", "grocer", "need", "potrebuj",
    "مساعدة", "ساعد", "تسوق", "допом", "потріб", "покуп",
  ],
  food: [
    "food", "bread", "meal", "breakfast", "lunch", "dinner", "grocery", "milk", "fridge",
    "jedlo", "raňajky", "obed", "večera", "chlieb", "mlieko", "chladni", "potraviny",
    "طعام", "أكل", "وجبة", "خبز", "فطور", "غداء", "عشاء", "حليب", "ثلاجة",
    "їжа", "їсти", "хліб", "молоко", "сніданок", "обід", "вечеря", "холодильник",
  ],
  medical: [
    "doctor", "medical", "hospital", "medicine", "clinic", "health", "sick", "pain", "pharmacy",
    "lekár", "doktor", "nemocnica", "liek", "ambulanc", "zdrav", "bolesť", "lekáren",
    "طبيب", "دكتور", "مستشفى", "دواء", "عيادة", "صحة", "ألم", "صيدلية",
    "лікар", "лікар", "лікарня", "ліки", "здоров", "біль", "аптек",
  ],
  ride: [
    "ride", "lift", "drive", "car", "transport", "station", "airport", "bus",
    "odvoz", "auto", "stanica", "letisko", "autobus", "doprava",
    "توصيل", "سيارة", "محطة", "مطار", "باص", "حافلة", "نقل",
    "підвез", "авто", "машина", "вокзал", "аеропорт", "автобус", "транспорт",
  ],
  legal: [
    "legal", "lawyer", "asylum", "residency", "document", "permit", "visa", "passport",
    "právn", "azyl", "pobyt", "povolenie", "doklad", "víza", "pas", "zmluv",
    "قانون", "محامي", "لجوء", "إقامة", "وثيقة", "تصريح", "تأشيرة", "جواز",
    "правов", "юрист", "адвокат", "притул", "прожив", "дозвіл", "віза", "паспорт", "документ",
  ],
  resource: [
    "resource", "donate", "give", "free", "clothes", "clothing", "shoes", "bank",
    "zdroj", "daruj", "zadarmo", "bezplatne", "oblečenie", "topánky", "šatník",
    "مورد", "تبرع", "مجان", "ملابس", "أحذية", "بنك",
    "ресурс", "дарую", "безкошт", "безплат", "одяг", "взуття",
  ],
  tech: [
    "tech", "wifi", "internet", "computer", "laptop", "phone", "router", "password",
    "technik", "počítač", "telefón", "heslo",
    "تقنية", "واي فاي", "إنترنت", "حاسوب", "هاتف", "كلمة السر",
    "техніка", "комп'ютер", "ноутбук", "телефон", "пароль",
  ],
  other: [],
};

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD");
}

export function guessCategory(query: string): Category {
  const q = normalize(query);
  if (!q.trim()) return "help";

  const scores = new Map<Category, number>();
  for (const cat of CATEGORIES) scores.set(cat, 0);

  // Score by keyword cues.
  for (const cat of CATEGORIES) {
    for (const cue of CATEGORY_CUES[cat]) {
      if (q.includes(normalize(cue))) {
        scores.set(cat, (scores.get(cat) ?? 0) + 1);
      }
    }
  }

  // Also boost categories whose localised label appears in the query.
  const languages = ["sk", "en", "ar", "uk"] as const;
  for (const lng of languages) {
    for (const cat of CATEGORIES) {
      const label = i18n.getFixedT(lng)(`categories.${cat}`);
      if (typeof label === "string" && label && q.includes(normalize(label))) {
        scores.set(cat, (scores.get(cat) ?? 0) + 2);
      }
    }
  }

  let best: Category = "help";
  let bestScore = 0;
  for (const [cat, score] of scores) {
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : "help";
}
