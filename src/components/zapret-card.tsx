"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuShieldCheck } from "react-icons/lu";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";

interface ZapretStatus {
  supported: boolean;
  running: boolean;
  state: string;
  preset?: string;
  presets?: string[];
  default?: string;
  others?: string[];
}

interface ZapretReply {
  ok: boolean;
  error?: string;
  status?: ZapretStatus;
}

/** Обход блокировок без VPN (zapret) для всей системы Windows — общий с Cloud VPN и Cloud Browser. */
export function ZapretCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ZapretStatus | null>(null);
  const [preset, setPreset] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const reply = await invoke<ZapretReply>("zapret_status");
      if (reply.status) setStatus(reply.status);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!preset && status) setPreset(status.preset || status.default || "");
  }, [status, preset]);

  if (!status?.supported) return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const reply = await invoke<ZapretReply>("zapret_set", { on, preset });
      if (reply.status) setStatus(reply.status);
      if (reply.ok) {
        showSuccessToast(on ? t("zapret.enabled") : t("zapret.disabled"));
      } else {
        showErrorToast(reply.error || t("zapret.failed"));
      }
    } catch (e) {
      showErrorToast(String(e));
    } finally {
      setBusy(false);
    }
  };

  const running = status.running;
  return (
    <div className="flex flex-col gap-2 rounded-md border px-3 py-3">
      <div className="flex items-center gap-2">
        <LuShieldCheck className="size-5" />
        <span className="font-medium">{t("zapret.title")}</span>
        <Badge variant={running ? "default" : "secondary"}>
          {running ? t("zapret.on") : t("zapret.off")}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t("zapret.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={preset}
          disabled={busy}
          onChange={(e) => setPreset(e.target.value)}
          aria-label={t("zapret.preset")}
        >
          {(status.presets || []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <LoadingButton isLoading={busy} onClick={() => void toggle(!running)}>
          {running ? t("zapret.disable") : t("zapret.enable")}
        </LoadingButton>
        {running && preset !== status.preset && (
          <LoadingButton
            isLoading={busy}
            variant="outline"
            onClick={() => void toggle(true)}
          >
            {t("zapret.apply")}
          </LoadingButton>
        )}
      </div>
      {status.others && status.others.length > 0 && (
        <p className="text-sm text-destructive">
          {t("zapret.others", { list: status.others.join(", ") })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t("zapret.antivirus")}</p>
    </div>
  );
}
