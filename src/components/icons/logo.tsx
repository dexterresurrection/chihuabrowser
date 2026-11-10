// Логотип Chihua Browser: переливающаяся зелёная сфера (assets/icon.svg)
export const Logo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 512 512"
    width={props.width ?? "1em"}
    height={props.height ?? "1em"}
    {...props}
  >
    <title>Chihua Browser</title>
    <defs>
      <radialGradient id="chihua-ball" cx="205" cy="185" r="260" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#eafff2" />
        <stop offset="0.28" stopColor="#46f08f" />
        <stop offset="0.68" stopColor="#00994a" />
        <stop offset="1" stopColor="#00361a" />
      </radialGradient>
      <linearGradient id="chihua-iri" x1="90" y1="120" x2="420" y2="400" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#33ffe8" stopOpacity="0.45" />
        <stop offset="0.35" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="0.6" stopColor="#fff176" stopOpacity="0.35" />
        <stop offset="0.85" stopColor="#7ab0ff" stopOpacity="0.35" />
        <stop offset="1" stopColor="#7ab0ff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="chihua-spec" cx="200" cy="160" r="80" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="256" cy="256" r="230" fill="url(#chihua-ball)" />
    <circle cx="256" cy="256" r="230" fill="url(#chihua-iri)" />
    <ellipse cx="200" cy="155" rx="90" ry="54" fill="url(#chihua-spec)" />
  </svg>
);
