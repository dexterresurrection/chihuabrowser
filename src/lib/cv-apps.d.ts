// Плашка «Наши приложения» / «Vice apps» из общего набора дизайна (/root/cloudvpn-design/web/cv-apps.js).
// Файл ставит globalThis.CvApps; подключается динамическим import() только в браузере.
export interface CvAppsOptions {
  line?: "auto" | "vice" | "cloud";
  platform?: "auto" | "android" | "windows" | "web";
  current?: string[];
  inWebView?: boolean;
  open?: (url: string) => void;
  lang?: "ru" | "en";
  replace?: boolean;
}
export interface CvAppsApi {
  plate(el: HTMLElement, opts?: CvAppsOptions): unknown;
  open(opts?: CvAppsOptions): unknown;
}
export {};
