import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    credentialRevision?: string;
    /** First factor behind a `two-factor` sign-in: password, google, github. */
    signInMethod?: string;
  }
  interface Session {
    credentialRevision?: string;
    /** Server-side `user_sessions` row; absent for pre-tracking cookies. */
    sessionId?: string;
    /** Signed rotation ticket, only ever sent through `unstable_update`. */
    rotation?: string;
    user: {
      id: string;
      githubLogin?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    localUserId?: string;
    credentialRevision?: string;
    /** Server-side `user_sessions` row id. */
    sid?: string;
    githubLogin?: string;
    githubConnectionCheckedAt?: number;
  }
}
