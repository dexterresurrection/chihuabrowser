"use client";

// Рекламная плашка внизу главного окна (место miami.main, ads.json из админки Cloud VPN): всегда видна, закрыть нельзя;
// нет баннеров — плашки нет. Ссылка открывается в браузере системы, только http(s).
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef } from "react";
import type { CvAdsApi } from "@/lib/cv-ads";

export function AdStrip() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let handle: { destroy(): void } | null = null;
    let dead = false;
    void import("@/lib/cv-ads").then(() => {
      const api = (globalThis as unknown as { CvAds?: CvAdsApi }).CvAds;
      if (!dead && el.current && api) {
        handle = api.plate(el.current, {
          slot: "miami.main",
          line: "auto",
          platform: "windows",
          open: (url) => {
            if (/^https?:\/\//i.test(url)) void openUrl(url);
          },
        });
      }
    });
    return () => {
      dead = true;
      handle?.destroy();
    };
  }, []);
  // высоту и отступы от краёв задаёт набор (низкая плашка): здесь только место
  return <div ref={el} className="shrink-0 px-3 pt-1 w-full" hidden />;
}
