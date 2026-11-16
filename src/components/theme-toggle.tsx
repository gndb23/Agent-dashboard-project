"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** Inline script (in <head>) that applies the saved theme before first paint. Dark is the default. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('agent-ops-theme');if(t!=='light'){document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}})();`;

export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("agent-ops-theme", next ? "dark" : "light");
    } catch {
      /* private mode */
    }
  };
  return (
    <button
      onClick={toggle}
      className="inline-flex h-8 w-8 items-center justify-center rounded-control text-fg-muted hover:bg-surface-hover hover:text-fg cursor-pointer"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
