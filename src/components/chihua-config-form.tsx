"use client";

import { useTranslation } from "react-i18next";
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
  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex flex-col gap-1.5">
        <Label>{t("chihuaForm.os")}</Label>
        <Select
          disabled={readOnly}
          value={config.os ?? getCurrentOS()}
          onValueChange={(value) => onConfigChange("os", value)}
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
