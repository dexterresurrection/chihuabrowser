export const Logo = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 100 100"
    width={props.width ?? "1em"}
    height={props.height ?? "1em"}
    {...props}
  >
    <title>Chihua Browser</title>
    <rect x="3" y="3" width="94" height="94" rx="22" fill="#0E1B19" />
    <path
      d="M71.2 28.8a30 30 0 1 0 0 42.4"
      fill="none"
      stroke="#E8B21A"
      strokeWidth="12.5"
    />
    <circle cx="50" cy="50" r="9" fill="#0EAAF1" />
  </svg>
);
