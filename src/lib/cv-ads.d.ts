// Рекламная плашка из общего набора дизайна (/root/cloudvpn-design/web/cv-ads.js); ставит globalThis.CvAds.
export interface CvAdsOptions {
  slot: string;
  line?: "auto" | "vice" | "cloud";
  platform?: "auto" | "android" | "windows" | "web";
  open?: (url: string) => void;
  sources?: string[];
  base?: string;
  asset?: (url: string) => string;
  send?: (body: string) => Promise<boolean>;
  clickVia?: "auto" | "counter" | "direct";
  replace?: boolean;
}
export interface CvAdsApi {
  plate(el: HTMLElement, opts: CvAdsOptions): { destroy(): void };
}
export {};
