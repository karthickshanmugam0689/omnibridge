import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store/useAppStore";
import { syncOutbox } from "@/lib/posts";
import OfflineBanner from "@/components/OfflineBanner";
import BottomNav from "@/components/BottomNav";
import FeedScreen from "@/screens/FeedScreen";
import NewPostScreen from "@/screens/NewPostScreen";
import ResourcesScreen from "@/screens/ResourcesScreen";
import SettingsScreen from "@/screens/SettingsScreen";

export default function App() {
  const { i18n } = useTranslation();
  const setOnline = useAppStore((s) => s.setOnline);
  const language = useAppStore((s) => s.language);

  useEffect(() => {
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void syncOutbox();
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
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 pt-4 pb-28">
        <Routes>
          <Route path="/" element={<FeedScreen />} />
          <Route path="/new" element={<NewPostScreen />} />
          <Route path="/resources" element={<ResourcesScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}
