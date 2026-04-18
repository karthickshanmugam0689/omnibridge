import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { Phone, Clock, MapPin } from "lucide-react";
import { db } from "@/lib/db";
import { CATEGORY_EMOJI } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

export default function ResourcesScreen() {
  const { t } = useTranslation();
  const language = useAppStore((s) => s.language);

  const resources = useLiveQuery(
    () =>
      db.posts
        .filter((p) => p.is_resource)
        .sortBy("created_at")
        .then((list) => list.reverse()),
    [],
    [],
  );

  return (
    <section className="space-y-4">
      <header>
        <h1>{t("resources.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("resources.subtitle")}</p>
      </header>

      <div className="space-y-4">
        {resources?.map((r) => {
          const title =
            language === "sk"
              ? r.title_sk
              : r.title_translations?.[language as "en" | "ar" | "uk"] ?? r.title_sk;
          const body =
            language === "sk"
              ? r.body_sk ?? ""
              : r.body_translations?.[language as "en" | "ar" | "uk"] ?? r.body_sk ?? "";
          return (
            <article key={r.id} className="card space-y-3">
              <header className="flex items-start gap-3">
                <div
                  className="text-4xl shrink-0 size-14 rounded-2xl bg-secondary/10 grid place-items-center"
                  aria-hidden
                >
                  {CATEGORY_EMOJI[r.category]}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-[22px] leading-snug">{title}</h3>
                  {r.location && (
                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                      <MapPin className="size-4" aria-hidden />
                      {r.location}
                    </p>
                  )}
                </div>
              </header>
              {body && <p className="leading-relaxed">{body}</p>}
              <div className="flex flex-wrap gap-2 text-sm">
                {r.last_status && (
                  <span className="chip bg-success/15 text-success">
                    <Clock className="size-4" aria-hidden /> {r.last_status}
                  </span>
                )}
                {r.author_name && (
                  <span className="chip">
                    <Phone className="size-4" aria-hidden /> {r.author_name}
                  </span>
                )}
              </div>
            </article>
          );
        })}

        {resources && resources.length === 0 && (
          <p className="text-muted-foreground">{t("feed.empty")}</p>
        )}
      </div>
    </section>
  );
}
