import { LockKeyhole, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

/**
 * Login-only visual treatment. The signup flow keeps the shared AuthShell:
 * this isolates the artwork and layout without touching authentication.
 * All decorative shapes are CSS/SVG; nothing external loads in the sign-in path.
 */
function LoginGavelArt() {
  return (
    <svg
      viewBox="0 0 300 224"
      fill="none"
      aria-hidden="true"
      className="pointer-events-none h-full w-full drop-shadow-[0_18px_22px_rgba(0,0,0,0.42)]"
    >
      <defs>
        <linearGradient id="login-gavel-gold" x1="82" y1="35" x2="212" y2="140" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFE0A0" />
          <stop offset=".28" stopColor="#F8A52B" />
          <stop offset=".64" stopColor="#C76C13" />
          <stop offset="1" stopColor="#FFE3AA" />
        </linearGradient>
        <linearGradient id="login-gavel-metal" x1="70" y1="28" x2="172" y2="175" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7188A9" />
          <stop offset=".35" stopColor="#263953" />
          <stop offset=".8" stopColor="#0B1729" />
          <stop offset="1" stopColor="#496383" />
        </linearGradient>
        <radialGradient id="login-gavel-light" cx="0" cy="0" r="1" gradientTransform="translate(148 166) rotate(90) scale(64 116)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F8A52B" stopOpacity=".5" />
          <stop offset="1" stopColor="#F8A52B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="146" cy="178" rx="120" ry="40" fill="url(#login-gavel-light)" />
      <ellipse cx="146" cy="194" rx="93" ry="17" fill="#07101C" />
      <path d="M51 187c0-18 44-31 96-31s96 13 96 31v10c0 17-43 25-96 25s-96-8-96-25v-10Z" fill="url(#login-gavel-metal)" stroke="#4A6485" strokeWidth="2" />
      <ellipse cx="147" cy="187" rx="96" ry="24" fill="#12213A" stroke="#B87A37" strokeWidth="3" />
      <ellipse cx="147" cy="185" rx="68" ry="12" fill="#AF6D22" opacity=".42" />
      <g transform="rotate(37 162 92)">
        <path d="M149 99h18v95c0 7-4 12-9 12s-9-5-9-12V99Z" fill="url(#login-gavel-metal)" stroke="#8092AA" strokeWidth="2" />
        <path d="M139 80h39v34h-39z" fill="url(#login-gavel-gold)" stroke="#F8D18E" strokeWidth="2" />
        <rect x="117" y="66" width="83" height="60" rx="12" fill="url(#login-gavel-metal)" stroke="#6885AA" strokeWidth="3" />
        <rect x="111" y="65" width="20" height="61" rx="8" fill="url(#login-gavel-gold)" stroke="#F9D898" strokeWidth="2" />
        <rect x="187" y="65" width="20" height="61" rx="8" fill="url(#login-gavel-gold)" stroke="#F9D898" strokeWidth="2" />
        <path d="M135 71h47" stroke="#C7D5E7" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />
      </g>
      <path d="M30 144c37-52 83-65 143-47" stroke="#347DFF" strokeOpacity=".16" strokeWidth="2" />
    </svg>
  );
}

export function LoginExperience({
  redirectTo,
  initialError,
}: {
  redirectTo: string;
  initialError?: string;
}) {
  return (
    <div className="login-stage relative isolate min-h-[calc(100svh-5rem)] overflow-hidden px-4 py-7 text-slate-50 sm:px-6 sm:py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-28 top-24 size-72 rounded-full bg-amber-500/10 blur-[90px] sm:size-[28rem]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 bottom-8 size-80 rounded-full bg-blue-500/15 blur-[100px] sm:size-[34rem]"
      />

      <div className="login-panel relative mx-auto w-full max-w-[720px] overflow-hidden rounded-[26px] border border-[#4D658A]/65 sm:rounded-[30px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_90%_0%,rgba(38,88,158,.25),transparent_47%),linear-gradient(150deg,rgba(22,38,63,.75),rgba(7,15,28,.2)_70%)]" aria-hidden="true" />
        <div className="relative">
          <div className="relative grid grid-cols-[minmax(0,1fr)_98px] items-center gap-1 overflow-hidden border-b border-[#597097]/35 px-5 pb-5 pt-6 sm:grid-cols-[minmax(0,1fr)_210px] sm:gap-3 sm:px-10 sm:pb-7 sm:pt-9">
            <div className="relative z-10 min-w-0">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-amber-300/90 sm:text-xs">Your marketplace account</p>
              <h1 className="text-[2rem] font-extrabold leading-[1.07] tracking-[-.045em] text-white sm:text-5xl">
                Welcome <span className="text-[#FFAB32]">back.</span>
              </h1>
              <p className="mt-3 max-w-md text-[13px] leading-5 text-slate-300 sm:mt-4 sm:text-base sm:leading-7">
                Sign in to buy, sell and chat with people across Zimbabwe.
              </p>
            </div>
            <div className="relative -mr-5 h-32 w-[130px] justify-self-end sm:-mr-6 sm:h-[200px] sm:w-[250px]">
              <LoginGavelArt />
            </div>
          </div>

          <div className="px-5 pb-6 pt-6 sm:px-10 sm:pb-9 sm:pt-7">
            <LoginForm redirectTo={redirectTo} initialError={initialError} />
            <p className="mt-7 flex items-center justify-center gap-2 border-t border-[#455975]/45 pt-5 text-center text-xs text-slate-400">
              <LockKeyhole className="size-3.5 shrink-0 text-amber-300" aria-hidden />
              Secure sign-in to your BidBlitz account
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-5 flex max-w-[720px] items-center justify-center gap-2 text-center text-xs text-slate-400">
        <ShieldCheck className="size-4 text-amber-300/80" aria-hidden />
        Local deals. Direct seller contact. Your choice.
      </div>
    </div>
  );
}
