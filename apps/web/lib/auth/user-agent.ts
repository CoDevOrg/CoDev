const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\/|\bChrome\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
  [/\bcodev\b|\bCoDev\b|\bExpo\b|\bokhttp\b/, "CoDev app"],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/\biPhone\b|\biPad\b|\biOS\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

/** "Chrome on macOS" for a session row; no third-party parser needed. */
export function describeUserAgent(userAgent: string | null | undefined) {
  if (!userAgent) return { label: "Unknown device", mobile: false };
  const browser =
    BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "Browser";
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  return {
    label: system ? `${browser} on ${system}` : browser,
    mobile: /\bMobi|\biPhone\b|\bAndroid\b/.test(userAgent),
  };
}
