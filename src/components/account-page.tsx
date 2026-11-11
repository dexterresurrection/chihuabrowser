"use client";

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuCloud, LuLogOut, LuRefreshCw } from "react-icons/lu";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import { cn } from "@/lib/utils";

interface CloudVpnServer {
  proxy_id: string;
  name: string;
  protocol: string;
}

interface CloudVpnStatus {
  logged_in: boolean;
  email: string | null;
  subscription_active: boolean | null;
  subscription_end: string | null;
  servers: CloudVpnServer[];
}

interface DeviceLogin {
  user_code: string;
  verification_url: string;
  telegram_url: string | null;
  expires_in: number;
}

interface AccountPageProps {
  isOpen: boolean;
  onClose: () => void;
  subPage?: boolean;
}

/** The account of our service: sign in, and the subscription's servers become proxies for profiles. */
export function AccountPage({ isOpen, onClose, subPage }: AccountPageProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CloudVpnStatus | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<DeviceLogin | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<CloudVpnStatus>("cloudvpn_status"));
    } catch (error) {
      showErrorToast(String(error));
    }
  }, []);

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh]);

  const run = useCallback(
    async (action: () => Promise<unknown>, done?: string) => {
      setBusy(true);
      try {
        await action();
        if (done) showSuccessToast(done);
        await refresh();
      } catch (error) {
        const message = String(error);
        showErrorToast(
          message === "LEGAL_CONSENT_REQUIRED"
            ? t("cloudVpn.consentRequired")
            : message,
        );
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  const sync = useCallback(
    () =>
      run(
        () => invoke("cloudvpn_sync_servers"),
        t("cloudVpn.serversUpdated"),
      ),
    [run, t],
  );

  const afterLogin = useCallback(async () => {
    await invoke("cloudvpn_sync_servers").catch(() => undefined);
    setCode("");
    setPassword("");
    setCodeSent(false);
  }, []);

  // Вход по коду: Telegram (через бота) или браузер (Google, Discord, GitHub, почта на сайте кабинета)
  const startDevice = useCallback(
    async (via: "telegram" | "browser") => {
      try {
        const login = await invoke<DeviceLogin>("cloudvpn_device_start");
        setDevice(login);
        await openUrl(
          via === "telegram" && login.telegram_url
            ? login.telegram_url
            : login.verification_url,
        );
      } catch (error) {
        showErrorToast(String(error));
      }
    },
    [],
  );

  useEffect(() => {
    if (!device) return;
    let stopped = false;
    const until = Date.now() + device.expires_in * 1000;
    const tick = async () => {
      if (stopped) return;
      if (Date.now() > until) {
        setDevice(null);
        showErrorToast(t("cloudVpn.deviceExpired"));
        return;
      }
      try {
        const state = await invoke<string>("cloudvpn_device_poll");
        if (stopped) return;
        if (state === "done") {
          setDevice(null);
          await afterLogin();
          await refresh();
          showSuccessToast(t("cloudVpn.signedIn"));
          return;
        }
      } catch (error) {
        if (stopped) return;
        setDevice(null);
        showErrorToast(String(error));
        return;
      }
      setTimeout(() => void tick(), 2000);
    };
    const first = setTimeout(() => void tick(), 2000);
    return () => {
      stopped = true;
      clearTimeout(first);
    };
  }, [device, afterLogin, refresh, t]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose} subPage={subPage}>
      <DialogContent className="max-w-2xl max-h-[calc(100vh-4rem)] flex flex-col">
        <div
          className={cn(
            "flex flex-col gap-4 p-4 overflow-y-auto flex-1 min-h-0",
            subPage && "w-full max-w-2xl mx-auto",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="grid place-items-center size-12 rounded-full bg-accent text-foreground">
              <LuCloud className="size-6" />
            </div>
            <div className="min-w-0">
              <p className="font-medium">{t("cloudVpn.title")}</p>
              <p className="text-sm text-muted-foreground truncate">
                {status?.logged_in ? status.email : t("cloudVpn.subtitle")}
              </p>
            </div>
          </div>

          {!status?.logged_in ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void startDevice("telegram")}>
                  {t("cloudVpn.viaTelegram")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void startDevice("browser")}
                >
                  {t("cloudVpn.viaBrowser")}
                </Button>
              </div>
              {device && (
                <div className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {t("cloudVpn.deviceCode")}
                  </span>
                  <span className="font-mono text-2xl font-bold tracking-widest">
                    {device.user_code}
                  </span>
                  <span className="text-muted-foreground">
                    {t("cloudVpn.deviceHint")}
                  </span>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void openUrl(device.verification_url)}
                    >
                      {t("cloudVpn.openSite")}
                    </Button>
                    {device.telegram_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          device.telegram_url &&
                          void openUrl(device.telegram_url)
                        }
                      >
                        {t("cloudVpn.openBot")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDevice(null)}
                    >
                      {t("cloudVpn.cancel")}
                    </Button>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("cloudVpn.orEmail")}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cloudvpn-email">{t("cloudVpn.email")}</Label>
                <Input
                  id="cloudvpn-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {usePassword ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cloudvpn-password">
                    {t("cloudVpn.password")}
                  </Label>
                  <Input
                    id="cloudvpn-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              ) : (
                codeSent && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="cloudvpn-code">{t("cloudVpn.code")}</Label>
                    <Input
                      id="cloudvpn-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </div>
                )
              )}
              <div className="flex items-center gap-2">
                <LoadingButton
                  isLoading={busy}
                  disabled={!email}
                  onClick={() => {
                    if (usePassword) {
                      void run(async () => {
                        await invoke("cloudvpn_login_password", {
                          email,
                          password,
                        });
                        await afterLogin();
                      });
                    } else if (codeSent) {
                      void run(async () => {
                        await invoke("cloudvpn_verify_code", { email, code });
                        await afterLogin();
                      });
                    } else {
                      void run(async () => {
                        await invoke("cloudvpn_request_code", { email });
                        setCodeSent(true);
                      }, t("cloudVpn.codeSent"));
                    }
                  }}
                >
                  {usePassword || codeSent
                    ? t("cloudVpn.signIn")
                    : t("cloudVpn.sendCode")}
                </LoadingButton>
                <Button
                  variant="ghost"
                  onClick={() => setUsePassword(!usePassword)}
                >
                  {usePassword
                    ? t("cloudVpn.useCode")
                    : t("cloudVpn.usePassword")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant={status.subscription_active ? "default" : "secondary"}
                >
                  {status.subscription_active
                    ? t("cloudVpn.subscriptionActive")
                    : t("cloudVpn.subscriptionNone")}
                </Badge>
                {status.subscription_end && (
                  <span className="text-sm text-muted-foreground">
                    {t("cloudVpn.until", {
                      date: status.subscription_end.slice(0, 10),
                    })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <LoadingButton
                  isLoading={busy}
                  className="gap-2"
                  onClick={() => void sync()}
                >
                  <LuRefreshCw className="size-4" />
                  {t("cloudVpn.updateServers")}
                </LoadingButton>
                <Button
                  variant="ghost"
                  className="gap-2"
                  onClick={() => void run(() => invoke("cloudvpn_logout"))}
                >
                  <LuLogOut className="size-4" />
                  {t("cloudVpn.signOut")}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("cloudVpn.hint")}
              </p>
              <ul className="flex flex-col gap-1">
                {status.servers.map((server) => (
                  <li
                    key={server.proxy_id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="truncate">{server.name}</span>
                    <span className="text-xs text-muted-foreground uppercase">
                      {server.protocol}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
