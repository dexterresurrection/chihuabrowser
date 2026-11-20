// Загрузчики общего набора дизайна: «пёс догоняет зайца», в темах Vice — маслкар, катер, у Chihua-талисмана — гидроцикл (/root/cloudvpn-design/web/cv-loader.js).
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
      kind?: "chase" | "eater" | "car" | "boat" | "jetski" | "auto";
      label?: string;
      size?: number;
      compact?: boolean;
      progress?: number | "loop";
    },
  ): CvLoaderHandle;
}
export {};
