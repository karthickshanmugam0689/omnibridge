import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, PlusCircle, LifeBuoy, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", icon: Home, key: "nav.feed" },
  { to: "/new", icon: PlusCircle, key: "nav.new" },
  { to: "/resources", icon: LifeBuoy, key: "nav.resources" },
  { to: "/settings", icon: Settings, key: "nav.settings" },
];

export default function BottomNav() {
  const { t } = useTranslation();
  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-border z-40"
      aria-label="Primary"
    >
      <ul className="max-w-2xl mx-auto grid grid-cols-4">
        {items.map(({ to, icon: Icon, key }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-1 min-h-touch py-2 px-2 text-sm font-bold",
                  isActive
                    ? "text-primary"
                    : "text-ink/70 hover:text-ink",
                )
              }
            >
              <Icon className="size-6" aria-hidden />
              <span>{t(key)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
