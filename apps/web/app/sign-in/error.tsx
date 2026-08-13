"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function SignInError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error("The CoDev sign-in page could not be rendered.", error);
  }, [error]);

  return (
    <main className="auth-page">
      <div className="auth-nav">
        <Link aria-label="CoDev home" href="/">
          CoDev
        </Link>
        <Link href="/">Back</Link>
      </div>
      <section className="auth-card">
        <p className="eyebrow">Sign in unavailable</p>
        <h1>We could not load sign-in.</h1>
        <p>
          Your account details are safe. Please try again; if this continues,
          return to the home page and try later.
        </p>
        <button className="auth-submit" type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
