"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChihuaConfig, ChihuaOS } from "@/types";

interface ChihuaConfigFormProps {
  config: ChihuaConfig;
  onConfigChange: (key: keyof ChihuaConfig, value: unknown) => void;
  className?: string;
  isCreating?: boolean;
  forceAdvanced?: boolean;
  readOnly?: boolean;
  crossOsUnlocked?: boolean;
  limitedMode?: boolean;
  profileVersion?: string;
  profileBrowser?: string;
}

const getCurrentOS = (): ChihuaOS => {
  if (typeof navigator === "undefined") return "windows";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("linux")) return "linux";
  return "windows";
};

// Библиотека устройств: те же id, что DEVICE_PRESETS в chihua_manager.rs. Устройство задаёт систему, бренд браузера
// и число ядер; остальное движок строит из случайного зерна, поэтому каждый профиль — отдельное устройство.
const DEVICES: { id: string; os: ChihuaOS; label: string }[] = [
  { id: "win-laptop", os: "windows", label: "Windows · Chrome · ноутбук, 4 ядра" },
  { id: "win-home", os: "windows", label: "Windows · Chrome · домашний ПК, 8 ядер" },
  { id: "win-gaming", os: "windows", label: "Windows · Chrome · игровой ПК, 16 ядер" },
  { id: "win-edge", os: "windows", label: "Windows · Edge · рабочий ноутбук, 8 ядер" },
  { id: "win-opera", os: "windows", label: "Windows · Opera · 6 ядер" },
  { id: "mac-air", os: "macos", label: "macOS · Chrome · MacBook Air, 8 ядер" },
  { id: "mac-pro", os: "macos", label: "macOS · Chrome · MacBook Pro, 12 ядер" },
  { id: "linux", os: "linux", label: "Linux · Chrome · 8 ядер" },
];
const ANY_DEVICE = "any";

const OS_OPTIONS: { value: ChihuaOS; label: string }[] = [
  { value: "windows", label: "Windows" },
  { value: "macos", label: "macOS" },
  { value: "linux", label: "Linux" },
];

/**
 * The engine builds the whole device from a seed inside the browser, so there are no separate values to edit here:
 * the system it shows and whether every launch is a new device.
 */
export function ChihuaConfigForm({
  config,
  onConfigChange,
  className = "",
  readOnly = false,
}: ChihuaConfigFormProps) {
  const { t } = useTranslation();
  // другое устройство — новый отпечаток (его создаст программа при сохранении или запуске)
  const pickDevice = (id: string) => {
    const device = DEVICES.find((d) => d.id === id);
    onConfigChange("device", device ? device.id : undefined);
    if (device) onConfigChange("os", device.os);
    onConfigChange("fingerprint", undefined);
  };

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex flex-col gap-1.5">
        <Label>{t("chihuaForm.device")}</Label>
        <Select
          disabled={readOnly}
          value={config.device ?? ANY_DEVICE}
          onValueChange={pickDevice}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_DEVICE}>{t("chihuaForm.anyDevice")}</SelectItem>
            {DEVICES.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {device.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground flex-1">
            {t("chihuaForm.deviceHint")}
          </p>
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onConfigChange("fingerprint", undefined)}
            >
              {t("chihuaForm.newDevice")}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("chihuaForm.os")}</Label>
        <Select
          disabled={readOnly}
          value={config.os ?? getCurrentOS()}
          onValueChange={(value) => {
            onConfigChange("os", value);
            onConfigChange("device", undefined);
            onConfigChange("fingerprint", undefined);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("chihuaForm.osHint")}</p>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="chihua-randomize"
          disabled={readOnly}
          checked={config.randomize_fingerprint_on_launch === true}
          onCheckedChange={(checked) =>
            onConfigChange("randomize_fingerprint_on_launch", checked === true)
          }
        />
        <Label htmlFor="chihua-randomize">{t("chihuaForm.randomize")}</Label>
      </div>
    </div>
  );
}
