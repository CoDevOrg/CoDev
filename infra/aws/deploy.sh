#!/usr/bin/env bash
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly region="${AWS_REGION:-us-east-2}"
readonly account_id="$(aws sts get-caller-identity --query Account --output text)"
readonly team_slug="${VERCEL_TEAM_SLUG:-yousef20920s-projects}"
readonly project_name="${VERCEL_PROJECT_NAME:-codev}"
readonly instance_type="${CODEV_INSTANCE_TYPE:-a1.metal}"
readonly availability_zone="${CODEV_AVAILABILITY_ZONE:-us-east-2a}"
readonly host_ami_id="${CODEV_HOST_AMI_ID:-ami-0713df58d0d8b3c1c}"
readonly host_volume_size_gib="${CODEV_HOST_VOLUME_SIZE_GIB:-40}"
readonly release_version="${CODEV_RELEASE_VERSION:-$(git -C "${repo_root}" rev-parse --short=12 HEAD)}"
readonly artifact_bucket="${CODEV_ARTIFACT_BUCKET:-codev-runtime-${account_id}-${region}}"
readonly artifacts_stack="${CODEV_ARTIFACTS_STACK:-codev-runtime-artifacts}"
readonly runtime_stack="${CODEV_RUNTIME_STACK:-codev-runtime}"
readonly oidc_url="https://oidc.vercel.com/${team_slug}"
readonly oidc_host="oidc.vercel.com/${team_slug}"
readonly oidc_audience="https://vercel.com/${team_slug}"

build_dir="$(mktemp -d)"
trap 'rm -rf "${build_dir}"' EXIT

echo "Building CoDev runtime ${release_version} for linux/arm64"
(
  cd "${repo_root}/services/orchestrator"
  cargo zigbuild --locked --release --target aarch64-unknown-linux-musl
  cp \
    target/aarch64-unknown-linux-musl/release/orchestrator \
    "${build_dir}/codev-orchestrator-linux-arm64"
  cp \
    target/aarch64-unknown-linux-musl/release/guestd \
    "${build_dir}/codev-guestd-linux-arm64"
)

aws cloudformation deploy \
  --region "${region}" \
  --stack-name "${artifacts_stack}" \
  --template-file "${repo_root}/infra/aws/cloudformation/artifacts.yaml" \
  --parameter-overrides "BucketName=${artifact_bucket}" \
  --no-fail-on-empty-changeset

for artifact in codev-orchestrator-linux-arm64 codev-guestd-linux-arm64; do
  aws s3 cp \
    "${build_dir}/${artifact}" \
    "s3://${artifact_bucket}/releases/${release_version}/${artifact}" \
    --region "${region}" \
    --sse AES256 \
    --only-show-errors
done
aws s3 cp \
  "${repo_root}/infra/aws/scripts/bootstrap-host.sh" \
  "s3://${artifact_bucket}/releases/${release_version}/bootstrap-host.sh" \
  --region "${region}" \
  --sse AES256 \
  --only-show-errors

aws cloudformation deploy \
  --region "${region}" \
  --stack-name "${runtime_stack}" \
  --template-file "${repo_root}/infra/aws/cloudformation/runtime.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    "ArtifactBucket=${artifact_bucket}" \
    "ReleaseVersion=${release_version}" \
    "InstanceType=${instance_type}" \
    "AvailabilityZone=${availability_zone}" \
    "UbuntuAmi=${host_ami_id}" \
    "HostVolumeSizeGiB=${host_volume_size_gib}" \
  --no-fail-on-empty-changeset

api_id="$(aws cloudformation describe-stacks \
  --region "${region}" \
  --stack-name "${runtime_stack}" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiId'].OutputValue" \
  --output text)"
api_url="$(aws cloudformation describe-stacks \
  --region "${region}" \
  --stack-name "${runtime_stack}" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text)"
instance_id="$(aws cloudformation describe-stacks \
  --region "${region}" \
  --stack-name "${runtime_stack}" \
  --query "Stacks[0].Outputs[?OutputKey=='HostInstanceId'].OutputValue" \
  --output text)"

oidc_provider_arn="arn:aws:iam::${account_id}:oidc-provider/${oidc_host}"
if ! aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "${oidc_provider_arn}" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider \
    --url "${oidc_url}" \
    --client-id-list "${oidc_audience}" \
    --tags Key=Project,Value=CoDev Key=ManagedBy,Value=codev-deploy-script >/dev/null
fi

ensure_vercel_role() {
  local environment="$1"
  local role_name="codev-vercel-${environment}"
  local subject="owner:${team_slug}:project:${project_name}:environment:${environment}"
  local trust_policy
  local invoke_policy

  trust_policy="$(jq -cn \
    --arg provider "${oidc_provider_arn}" \
    --arg audience_key "${oidc_host}:aud" \
    --arg subject_key "${oidc_host}:sub" \
    --arg audience "${oidc_audience}" \
    --arg subject "${subject}" \
    '{
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: {Federated: $provider},
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            ($audience_key): $audience,
            ($subject_key): $subject
          }
        }
      }]
    }')"
  invoke_policy="$(jq -cn \
    --arg resource "arn:aws:execute-api:${region}:${account_id}:${api_id}/*/*/*" \
    --arg instance "arn:aws:ec2:${region}:${account_id}:instance/${instance_id}" \
    '{
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "execute-api:Invoke",
          Resource: $resource
        },
        {
          Effect: "Allow",
          Action: "ec2:StartInstances",
          Resource: $instance
        },
        {
          Effect: "Allow",
          Action: "ec2:DescribeInstances",
          Resource: "*"
        }
      ]
    }')"

  if aws iam get-role --role-name "${role_name}" >/dev/null 2>&1; then
    aws iam update-assume-role-policy \
      --role-name "${role_name}" \
      --policy-document "${trust_policy}"
  else
    aws iam create-role \
      --role-name "${role_name}" \
      --description "CoDev ${environment} Vercel functions via OIDC" \
      --assume-role-policy-document "${trust_policy}" \
      --tags Key=Project,Value=CoDev Key=Environment,Value="${environment}" >/dev/null
  fi
  aws iam put-role-policy \
    --role-name "${role_name}" \
    --policy-name InvokeCoDevRuntime \
    --policy-document "${invoke_policy}"
  aws iam get-role --role-name "${role_name}" --query Role.Arn --output text
}

production_role_arn="$(ensure_vercel_role production)"
preview_role_arn="$(ensure_vercel_role preview)"

jq -n \
  --arg accountId "${account_id}" \
  --arg region "${region}" \
  --arg releaseVersion "${release_version}" \
  --arg artifactBucket "${artifact_bucket}" \
  --arg apiUrl "${api_url}" \
  --arg instanceId "${instance_id}" \
  --arg productionRoleArn "${production_role_arn}" \
  --arg previewRoleArn "${preview_role_arn}" \
  '{
    accountId: $accountId,
    region: $region,
    releaseVersion: $releaseVersion,
    artifactBucket: $artifactBucket,
    apiUrl: $apiUrl,
    instanceId: $instanceId,
    productionRoleArn: $productionRoleArn,
    previewRoleArn: $previewRoleArn
  }'
