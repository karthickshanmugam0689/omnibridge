import { useTranslation } from "react-i18next";
import { CATEGORIES, CATEGORY_EMOJI, DAYS, BUCKETS, type Availability, type Bucket, type Category, type Day } from "@/lib/types";
import { cn } from "@/lib/utils";

interface HelperPrefsEditorProps {
  tags: Category[];
  onTagsChange: (tags: Category[]) => void;
  availability: Availability;
  onAvailabilityChange: (a: Availability) => void;
  /** Show inline hints below each label. Enabled by default. */
  showHints?: boolean;
}

/**
 * Shared UI for picking helper tags (categories) and a weekly availability
 * grid. Used from both Onboarding step 2 and the Settings screen so the two
 * places can never drift in visual style, tap-target size or i18n keys.
 *
 * Design choices:
 *   - Chips for categories: stay familiar, wrap nicely on small screens,
 *     reuse the existing `CATEGORY_EMOJI` map so icons stay consistent with
 *     the post feed.
 *   - 7-column availability grid (one column per weekday). Three rows:
 *     morning / afternoon / evening. Each cell is ≥56px tall to stay above
 *     the arthritis-friendly 44px minimum and comfortable for a thumb.
 *   - Cells toggle individually. Tapping the day header toggles the whole
 *     column at once (common enough that we save taps without adding a
 *     secondary "select all" control).
 */
export default function HelperPrefsEditor({
  tags,
  onTagsChange,
  availability,
  onAvailabilityChange,
  showHints = true,
}: HelperPrefsEditorProps) {
  const { t } = useTranslation();

  const toggleTag = (c: Category) => {
    const next = tags.includes(c) ? tags.filter((x) => x !== c) : [...tags, c];
    onTagsChange(next);
  };

  const cellActive = (day: Day, bucket: Bucket) =>
    availability[day]?.includes(bucket) ?? false;

  const toggleCell = (day: Day, bucket: Bucket) => {
    const cur = availability[day] ?? [];
    const nextForDay = cur.includes(bucket)
      ? cur.filter((b) => b !== bucket)
      : [...cur, bucket];
    const next: Availability = { ...availability };
    if (nextForDay.length === 0) delete next[day];
    else next[day] = nextForDay;
    onAvailabilityChange(next);
  };

  const toggleDay = (day: Day) => {
    // If any bucket is on, clear the column. Otherwise, set all three buckets.
    const cur = availability[day] ?? [];
    const next: Availability = { ...availability };
    if (cur.length > 0) delete next[day];
    else next[day] = [...BUCKETS];
    onAvailabilityChange(next);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <p className="font-bold">{t("onboarding.helper.tagsLabel")}</p>
          {showHints && (
            <p className="text-sm text-muted-foreground mt-1">
              {t("onboarding.helper.tagsHint")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const selected = tags.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleTag(c)}
                aria-pressed={selected}
                className={cn(
                  "min-h-touch inline-flex items-center gap-2 rounded-full px-4 py-2 border-2 text-base font-semibold transition",
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-white text-ink hover:bg-muted",
                )}
              >
                <span className="text-xl" aria-hidden>
                  {CATEGORY_EMOJI[c]}
                </span>
                <span>{t(`categories.${c}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <p className="font-bold">{t("onboarding.helper.availabilityLabel")}</p>
          {showHints && (
            <p className="text-sm text-muted-foreground mt-1">
              {t("onboarding.helper.availabilityHint")}
            </p>
          )}
        </div>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: "auto repeat(7, minmax(0, 1fr))" }}
          role="grid"
          aria-label={t("onboarding.helper.availabilityLabel")}
        >
          <div />
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              aria-label={t(`days.${d}`)}
              className="text-xs font-bold text-muted-foreground text-center py-2 hover:text-ink"
            >
              {t(`days.${d}`)}
            </button>
          ))}
          {BUCKETS.map((b) => (
            <RowForBucket
              key={b}
              bucket={b}
              label={t(`buckets.${b}`)}
              cellActive={cellActive}
              toggleCell={toggleCell}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface RowForBucketProps {
  bucket: Bucket;
  label: string;
  cellActive: (d: Day, b: Bucket) => boolean;
  toggleCell: (d: Day, b: Bucket) => void;
}

function RowForBucket({ bucket, label, cellActive, toggleCell }: RowForBucketProps) {
  return (
    <>
      <div className="text-sm font-semibold pe-2 self-center text-muted-foreground">
        {label}
      </div>
      {DAYS.map((d) => {
        const active = cellActive(d, bucket);
        return (
          <button
            key={`${d}-${bucket}`}
            type="button"
            role="gridcell"
            aria-pressed={active}
            aria-label={`${label} · ${d}`}
            onClick={() => toggleCell(d, bucket)}
            className={cn(
              "min-h-[56px] rounded-xl border-2 transition",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-white hover:bg-muted",
            )}
          />
        );
      })}
    </>
  );
}
