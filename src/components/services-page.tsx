"use client";

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuExternalLink, LuHouse, LuRefreshCw } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { ZapretCard } from "@/components/zapret-card";
import type { CvLoaderHandle, CvLoadersApi } from "@/lib/cv-loader";

/** Модули наших сервисов в левом меню Chihua: всё открывается внутри окна. */
export type ServiceId =
  | "cabinet"
  | "mail"
  | "messenger"
  | "social"
  | "wallet"
  | "zapret"
  | "apps";

export const SERVICE_IDS: ServiceId[] = [
  "cabinet",
  "mail",
  "messenger",
  "social",
  "wallet",
  "zapret",
  "apps",
];

const CABINET = "https://cabinet.zjd.uk";

// web — страница, открывается дочерним WebView в области страницы; app — программа без веб-версии
const SERVICES: Record<
  ServiceId,
  { web?: string; products?: string[]; win?: string }
> = {
  cabinet: { web: `${CABINET}/` },
  mail: { web: `${CABINET}/mail` },
  messenger: { products: ["messenger-win", "messenger"], win: "messenger" },
  social: { products: ["social-win", "social"], win: "social" },
  wallet: { products: ["wallet"], win: "wallet" },
  zapret: {},
  apps: {},
};

export function isServicePage(page: string): page is ServiceId {
  return (SERVICE_IDS as string[]).includes(page);
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(el: HTMLElement): Bounds {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** Пёс догоняет зайца (общий загрузчик набора дизайна): пока модуль не нарисовался поверх. */
function ChaseLoader({ label }: { label: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let handle: CvLoaderHandle | null = null;
    let dead = false;
    void import("@/lib/cv-loader").then(() => {
      const api = (globalThis as unknown as { CvLoaders?: CvLoadersApi })
        .CvLoaders;
      if (!dead && el.current && api) {
        handle = api.cvLoader(el.current, { kind: "chase", label });
      }
    });
    return () => {
      dead = true;
      handle?.destroy();
    };
  }, [label]);
  return <div ref={el} className="w-full max-w-md mx-auto pt-16 px-6" />;
}

/** Веб-модуль: дочерний WebView точно над этим блоком; уходим со страницы — модуль прячется, но живёт. */
function WebModule({ id, url }: { id: ServiceId; url: string }) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let alive = true;
    invoke("service_view_show", { id, url, bounds: rectOf(el) }).catch(
      (e: unknown) => {
        if (alive) setError(String(e));
      },
    );
    const update = () => {
      if (box.current) {
        void invoke("service_view_bounds", {
          id,
          bounds: rectOf(box.current),
        }).catch(() => undefined);
      }
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      alive = false;
      ro.disconnect();
      window.removeEventListener("resize", update);
      void invoke("service_view_hide").catch(() => undefined);
    };
  }, [id, url]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-sm font-medium flex-1 truncate">
          {t(`services.${id}.title`)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          title={t("services.home")}
          onClick={() => {
            void invoke("service_view_reload", { id, url });
          }}
        >
          <LuHouse className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title={t("services.reload")}
          onClick={() => {
            void invoke("service_view_reload", { id, url: null });
          }}
        >
          <LuRefreshCw className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title={t("services.openInBrowser")}
          onClick={() => {
            void openUrl(url);
          }}
        >
          <LuExternalLink className="size-3.5" />
        </Button>
      </div>
      <div ref={box} className="flex-1 min-h-0 relative">
        {error ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : (
          <ChaseLoader label={t("services.loading")} />
        )}
      </div>
    </div>
  );
}

interface FileEntry {
  label?: string;
  name: string;
  size?: number;
  github?: string;
  bucket?: string;
  server?: string;
}
interface Product {
  title?: string;
  version?: string;
  files?: FileEntry[];
}
interface AppInfo {
  id: string;
  name: string;
  installed: boolean;
  version?: string | null;
}

function ProductCard({ product }: { product: Product }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 first:border-0 first:pt-0">
      <div>
        <div className="text-sm font-medium">{product.title}</div>
        <div className="text-xs text-muted-foreground">
          {t("services.version", { version: product.version ?? "" })}
        </div>
      </div>
      {(product.files ?? []).map((f) => (
        <div key={f.name} className="flex flex-col gap-1">
          <div className="text-xs text-muted-foreground">
            {f.label ?? f.name}
            {f.size ? ` · ${Math.round(f.size / 1048576)} MB` : ""}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["github", "GitHub"],
                ["bucket", t("services.mirror")],
                ["server", t("services.ourServer")],
              ] as const
            )
              .filter(([k]) => f[k])
              .map(([k, label], i) => (
                <Button
                  key={k}
                  size="sm"
                  variant={i === 0 ? "default" : "outline"}
                  onClick={() => {
                    const u = f[k];
                    if (u) void openUrl(u);
                  }}
                >
                  {label}
                </Button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function useDownloads() {
  const [products, setProducts] = useState<Record<string, Product> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<Record<string, Product>>("services_downloads")
      .then((p) => {
        setProducts(p ?? {});
      })
      .catch((e: unknown) => {
        setError(String(e));
      });
  }, []);
  return { products, error };
}

/** Программа без веб-версии: открыть установленную (одним щелчком) или установить. */
function AppModule({ id }: { id: ServiceId }) {
  const { t } = useTranslation();
  const svc = SERVICES[id];
  const { products, error } = useDownloads();
  const [app, setApp] = useState<AppInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!svc.win) return;
    invoke<AppInfo[]>("services_apps")
      .then((list) => {
        setApp(list.find((a) => a.id === svc.win) ?? null);
      })
      .catch(() => {
        setApp(null);
      });
  }, [svc.win]);
  useEffect(refresh, [refresh]);

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-2xl">
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
        <div className="text-base font-semibold">
          {t(`services.${id}.title`)}
        </div>
        <div className="text-sm text-muted-foreground">
          {t(`services.${id}.desc`)}
        </div>
        {app?.installed ? (
          <div className="flex items-center gap-2 pt-1">
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setNote(null);
                invoke("services_open_app", { id: svc.win })
                  .catch((e: unknown) => {
                    setNote(String(e));
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              {t("services.openApp", { name: app.name })}
            </Button>
            <span className="text-xs text-muted-foreground">
              {app.version
                ? t("services.installedVersion", { version: app.version })
                : t("services.installed")}
            </span>
          </div>
        ) : svc.win ? (
          <div className="text-xs text-muted-foreground">
            {t("services.notInstalled")}
          </div>
        ) : null}
        {note && <div className="text-xs text-destructive">{note}</div>}
      </div>
      {id === "zapret" && <ZapretCard />}
      {id !== "zapret" && (
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <div className="text-sm font-semibold">{t("services.install")}</div>
        {error && <div className="text-xs text-destructive">{error}</div>}
        {!products && !error && <ChaseLoader label={t("services.loading")} />}
        {products &&
          (id === "apps" ? Object.keys(products) : (svc.products ?? []))
            .filter((k) => products[k])
            .map((k) => <ProductCard key={k} product={products[k]} />)}
      </div>
      )}
    </div>
  );
}

export function ServicesPage({ id }: { id: ServiceId }) {
  const svc = SERVICES[id];
  if (svc.web) return <WebModule key={id} id={id} url={svc.web} />;
  return <AppModule key={id} id={id} />;
}
