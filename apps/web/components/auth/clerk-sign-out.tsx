"use client";

import { useClerk } from "@clerk/nextjs";

export function ClerkSignOut() {
  const { signOut } = useClerk();
  return (
    <button
      className="profile-menu-action"
      type="button"
      onClick={() => void signOut({ redirectUrl: "/" })}
    >
      Sign out
    </button>
  );
}
