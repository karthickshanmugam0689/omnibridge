import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X, Mic } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { startListening, voiceInputSupported, localeToBcp47, type VoiceSession } from "@/lib/voice";
import { cn } from "@/lib/utils";

/**
 * Search bar for the feed/resources screens.
 *
 * Value is kept in the global app store so that the FeedScreen and the
 * ResourcesScreen both react to it (and so navigation between tabs keeps
 * the user's query).
 */
export default function SearchBar() {
  const { t } = useTranslation();
  const query = useAppStore((s) => s.searchQuery);
  const setQuery = useAppStore((s) => s.setSearchQuery);
  const language = useAppStore((s) => s.language);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!listening) return;
    let session: VoiceSession | null = null;
    session = startListening({
      lang: localeToBcp47(language),
      onTranscript: (text) => setQuery(text),
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
    return () => {
      session?.stop();
    };
  }, [listening, language, setQuery]);

  const canVoice = voiceInputSupported();

  return (
    <div className="relative">
      <Search
        className="size-5 text-muted-foreground absolute start-4 top-1/2 -translate-y-1/2 pointer-events-none"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("search.placeholder")}
        aria-label={t("search.placeholder")}
        className="w-full rounded-2xl border border-border bg-white ps-12 pe-28 py-4 text-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
      />
      <div className="absolute end-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label={t("search.clear")}
            className="size-11 grid place-items-center rounded-full hover:bg-muted text-muted-foreground"
          >
            <X className="size-5" aria-hidden />
          </button>
        )}
        {canVoice && (
          <button
            type="button"
            onClick={() => setListening((v) => !v)}
            aria-pressed={listening}
            aria-label={t("search.voice")}
            className={cn(
              "size-12 grid place-items-center rounded-full",
              listening ? "bg-primary text-primary-foreground motion-safe:animate-pulse" : "hover:bg-muted text-ink",
            )}
          >
            <Mic className="size-5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
