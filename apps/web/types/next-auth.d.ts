import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    credentialRevision?: string;
  }
  interface Session {
    credentialRevision?: string;
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
    githubLogin?: string;
    githubConnectionCheckedAt?: number;
  }
}
