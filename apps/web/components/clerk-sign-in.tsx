"use client";

import { SignIn } from "@clerk/nextjs";

export function ClerkSignIn({ redirectUrl }: { redirectUrl: string }) {
  return <SignIn routing="hash" fallbackRedirectUrl={redirectUrl} />;
}
