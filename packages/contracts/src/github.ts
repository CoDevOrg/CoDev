export interface GitHubPickerAccount {
  id: number;
  account: { login: string; avatar_url: string; type: "User" | "Organization" };
}

export interface GitHubPickerRepository {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  installationId: number;
  sharedWith?: string[];
}
