// Загрузчик «пёс догоняет зайца» из общего набора дизайна (/root/cloudvpn-design/web/cv-loader.js).
// Файл ставит globalThis.CvLoaders; подключается динамическим import() только в браузере.
export interface CvLoaderHandle {
  set(pct: number): unknown;
  label(text: string): unknown;
  done(): Promise<unknown>;
  destroy(): void;
}
export interface CvLoadersApi {
  cvLoader(
    el: HTMLElement,
    opts?: {
      kind?: "chase" | "eater" | "auto";
      label?: string;
      size?: number;
      compact?: boolean;
      progress?: number | "loop";
    },
  ): CvLoaderHandle;
}
export {};
