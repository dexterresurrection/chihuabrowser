// Линия Chihua / Miami Browser: идёт за темой (theme-provider ставит класс vice на <html> и шлёт chihua-line).
import { useEffect, useState } from "react";

export type Line = "cloud" | "vice";

export function currentLine(): Line {
  return typeof document !== "undefined" &&
    document.documentElement.classList.contains("vice")
    ? "vice"
    : "cloud";
}

export function useLine(): Line {
  const [line, setLine] = useState<Line>(currentLine);
  useEffect(() => {
    const onLine = (e: Event) =>
      setLine((e as CustomEvent<string>).detail === "vice" ? "vice" : "cloud");
    window.addEventListener("chihua-line", onLine);
    setLine(currentLine());
    return () => window.removeEventListener("chihua-line", onLine);
  }, []);
  return line;
}
