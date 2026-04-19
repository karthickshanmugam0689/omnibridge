import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FONT_SCALE_VALUE, useAppStore } from "@/store/useAppStore";
import { syncOutbox } from "@/lib/posts";
import { syncResponseOutbox } from "@/lib/responses";
import { seedSampleDataIfEmpty } from "@/lib/sampleData";
import { buildMissingEmbeddings } from "@/lib/embeddings";
import { wireProfileSync, syncProfile, pullProfilePoints } from "@/lib/profile";
import OfflineBanner from "@/components/OfflineBanner";
import OnboardingModal from "@/components/OnboardingModal";
import PointsCelebration from "@/components/PointsCelebration";
import TopBar from "@/components/TopBar";
import BottomNav from "@/components/BottomNav";
import FeedScreen from "@/screens/FeedScreen";
import NewPostScreen from "@/screens/NewPostScreen";
import ResourcesScreen from "@/screens/ResourcesScreen";
import SettingsScreen from "@/screens/SettingsScreen";
import ListenScreen from "@/screens/ListenScreen";

export default function App() {
  const { i18n } = useTranslation();
  const setOnline = useAppStore((s) => s.setOnline);
  const language = useAppStore((s) => s.language);
  const fontScale = useAppStore((s) => s.fontScale);

  useEffect(() => {
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  // Push the selected font-size preset onto <html> via the --app-font-scale
  // CSS custom property (see index.css). Applied with `setProperty` so we
  // don't clobber any other inline styles on the root element.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-font-scale",
      String(FONT_SCALE_VALUE[fontScale] ?? 1),
    );
  }, [fontScale]);

  useEffect(() => {
    void (async () => {
      await seedSampleDataIfEmpty();
      if (typeof navigator !== "undefined" && "storage" in navigator && "persist" in navigator.storage) {
        try {
          await navigator.storage.persist();
        } catch {
          // Best-effort: browsers may deny silently for non-installed PWAs.
        }
      }
      // Kick off model download + indexing in the background. The UI never
      // awaits this — all screens degrade to keyword search while it runs.
      void buildMissingEmbeddings();
      // Wire the helper-profile store → Supabase sync and do one initial
      // upsert so returning users show up in the match engine even if they
      // don't edit their prefs this session.
      wireProfileSync();
      void syncProfile();
      // Pull the latest thank-you points total so Settings and the gamified
      // banner in Onboarding/Settings show the right number even before
      // realtime push of a resolved post reaches this device.
      void pullProfilePoints();
    })();
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void syncOutbox();
      void syncResponseOutbox();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [setOnline]);

  return (
    <div className="min-h-svh bg-surface text-ink flex flex-col">
      <OfflineBanner />
      <TopBar />
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 pt-4 pb-28">
        <Routes>
          <Route path="/" element={<FeedScreen />} />
          <Route path="/listen" element={<ListenScreen />} />
          <Route path="/new" element={<NewPostScreen />} />
          <Route path="/resources" element={<ResourcesScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
      <OnboardingModal />
      {/* Global overlay: celebrates whenever this device's helper is
          thanked. Works across every screen + after push-tap deep links. */}
      <PointsCelebration />
    </div>
  );
}
