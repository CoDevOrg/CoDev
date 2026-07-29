import "server-only";

import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { readServerEnvironment } from "@codev/config";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

export function getAwsConfiguration() {
  const environment = readServerEnvironment();
  if (!environment.AWS_REGION) {
    throw new Error("AWS_REGION is not configured.");
  }
  const credentials = environment.AWS_ROLE_ARN
    ? awsCredentialsProvider({
        roleArn: environment.AWS_ROLE_ARN,
        roleSessionName: "codev-vercel",
      })
    : defaultProvider();
  return {
    region: environment.AWS_REGION,
    credentials,
  };
}
