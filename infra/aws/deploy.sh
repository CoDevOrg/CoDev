#!/usr/bin/env bash
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly region="${AWS_REGION:-us-east-2}"
readonly account_id="$(aws sts get-caller-identity --query Account --output text)"
readonly team_slug="${VERCEL_TEAM_SLUG:-yousef20920s-projects}"
readonly project_name="${VERCEL_PROJECT_NAME:-codev}"
readonly instance_type="${CODEV_INSTANCE_TYPE:-m7i-flex.large}"
readonly host_arch="${CODEV_HOST_ARCH:-x86_64}"
readonly purchase_option="${CODEV_PURCHASE_OPTION:-spot}"
readonly availability_zone="${CODEV_AVAILABILITY_ZONE:-us-east-2a}"
case "${host_arch}" in
  x86_64)
    readonly rust_target="x86_64-unknown-linux-musl"
    readonly artifact_arch="x86_64"
    readonly ubuntu_arch="amd64"
    ;;
  aarch64)
    readonly rust_target="aarch64-unknown-linux-musl"
    readonly artifact_arch="arm64"
    readonly ubuntu_arch="arm64"
    ;;
  *)
    echo "CODEV_HOST_ARCH must be x86_64 or aarch64" >&2
    exit 1
    ;;
esac
if [[ "${purchase_option}" != "spot" && "${purchase_option}" != "on-demand" ]]; then
  echo "CODEV_PURCHASE_OPTION must be spot or on-demand" >&2
  exit 1
fi
host_ami_id="${CODEV_HOST_AMI_ID:-}"
if [[ -z "${host_ami_id}" ]]; then
  host_ami_id="$(aws ssm get-parameter \
    --region "${region}" \
    --name "/aws/service/canonical/ubuntu/server/24.04/stable/current/${ubuntu_arch}/hvm/ebs-gp3/ami-id" \
    --query 'Parameter.Value' \
    --output text)"
fi
readonly host_ami_id
readonly host_volume_size_gib="${CODEV_HOST_VOLUME_SIZE_GIB:-40}"
readonly jailer_volume_size_gib="${CODEV_JAILER_VOLUME_SIZE_GIB:-40}"
readonly monthly_budget_usd="${CODEV_MONTHLY_BUDGET_USD:-75}"
readonly budget_alert_email="${CODEV_BUDGET_ALERT_EMAIL:-}"
readonly release_version="${CODEV_RELEASE_VERSION:-$(git -C "${repo_root}" rev-parse --short=12 HEAD)}"
readonly artifact_bucket="${CODEV_ARTIFACT_BUCKET:-codev-runtime-${account_id}-${region}}"
readonly artifacts_stack="${CODEV_ARTIFACTS_STACK:-codev-runtime-artifacts}"
readonly runtime_stack="${CODEV_RUNTIME_STACK:-codev-runtime}"
readonly oidc_url="https://oidc.vercel.com/${team_slug}"
readonly oidc_host="oidc.vercel.com/${team_slug}"
readonly oidc_audience="https://vercel.com/${team_slug}"

readonly skip_orca_build="${CODEV_SKIP_ORCA_BUILD:-}"

build_dir="$(mktemp -d)"
trap 'rm -rf "${build_dir}"' EXIT

echo "Building CoDev runtime ${release_version} for linux/${artifact_arch}"
(
  cd "${repo_root}/services/orchestrator"
  cargo zigbuild --locked --release --target "${rust_target}"
  cp \
    "target/${rust_target}/release/orchestrator" \
    "${build_dir}/codev-orchestrator-linux-${artifact_arch}"
  cp \
    "target/${rust_target}/release/guestd" \
    "${build_dir}/codev-guestd-linux-${artifact_arch}"
)

# Building orca serve from source takes ~15-30 minutes; skip it for
# orchestrator-only iteration with CODEV_SKIP_ORCA_BUILD=1 once an
# matching orca-serve archive already exists at the target release version.
if [[ -n "${skip_orca_build}" ]]; then
  echo "CODEV_SKIP_ORCA_BUILD set; not rebuilding orca serve from source"
else
  "${repo_root}/infra/aws/scripts/build-orca-serve.sh" "${build_dir}" "${host_arch}"
fi

aws cloudformation deploy \
  --region "${region}" \
  --stack-name "${artifacts_stack}" \
  --template-file "${repo_root}/infra/aws/cloudformation/artifacts.yaml" \
  --parameter-overrides "BucketName=${artifact_bucket}" \
  --no-fail-on-empty-changeset

for artifact in "codev-orchestrator-linux-${artifact_arch}" "codev-guestd-linux-${artifact_arch}"; do
  aws s3 cp \
    "${build_dir}/${artifact}" \
    "s3://${artifact_bucket}/releases/${release_version}/${artifact}" \
    --region "${region}" \
    --sse AES256 \
    --only-show-errors
done
if [[ -f "${build_dir}/orca-serve-linux-${artifact_arch}.tar.gz" ]]; then
  for artifact in "orca-serve-linux-${artifact_arch}.tar.gz" "orca-serve-linux-${artifact_arch}.tar.gz.sha256"; do
    aws s3 cp \
      "${build_dir}/${artifact}" \
      "s3://${artifact_bucket}/releases/${release_version}/${artifact}" \
      --region "${region}" \
      --sse AES256 \
      --only-show-errors
  done
fi
aws s3 cp \
  "${repo_root}/infra/aws/scripts/bootstrap-host.sh" \
  "s3://${artifact_bucket}/releases/${release_version}/bootstrap-host.sh" \
  --region "${region}" \
  --sse AES256 \
  --only-show-errors
aws s3 cp \
  "${repo_root}/infra/aws/scripts/verify-lifecycle.sh" \
  "s3://${artifact_bucket}/releases/${release_version}/verify-lifecycle.sh" \
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
    "HostArchitecture=${host_arch}" \
    "PurchaseOption=${purchase_option}" \
    "AvailabilityZone=${availability_zone}" \
    "UbuntuAmi=${host_ami_id}" \
    "HostVolumeSizeGiB=${host_volume_size_gib}" \
    "JailerVolumeSizeGiB=${jailer_volume_size_gib}" \
    "MonthlyBudgetUsd=${monthly_budget_usd}" \
    "BudgetAlertEmail=${budget_alert_email}" \
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
credential_key_arn="$(aws cloudformation describe-stacks \
  --region "${region}" \
  --stack-name "${runtime_stack}" \
  --query "Stacks[0].Outputs[?OutputKey=='CredentialEncryptionKeyArn'].OutputValue" \
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
    --arg credential_key_arn "${credential_key_arn}" \
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
  # ec2:StartInstances is scoped by the host's own stable Name/Project tags
  # (set directly on the FirecrackerHost resource in runtime.yaml), not a
  # literal instance ARN: CloudFormation replaces that instance (new
  # instance ID) on host-affecting changes, and a literal-ARN policy would
  # silently go stale until the next full deploy.sh run re-derived it --
  # exactly what broke Vercel's ability to wake a replaced host once
  # already. Tag-scoping means any current or future host is always
  # covered with no follow-up IAM sync step required.
  invoke_policy="$(jq -cn \
    --arg resource "arn:aws:execute-api:${region}:${account_id}:${api_id}/*/*/*" \
    --arg instance_wildcard "arn:aws:ec2:${region}:${account_id}:instance/*" \
    --arg credential_key_arn "${credential_key_arn}" \
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
          Resource: $instance_wildcard,
          Condition: {
            StringEquals: {
              "ec2:ResourceTag/Name": "codev-firecracker-host",
              "ec2:ResourceTag/Project": "CoDev"
            }
          }
        },
        {
          Effect: "Allow",
          Action: "ec2:DescribeInstances",
          Resource: "*"
        },
        {
          Effect: "Allow",
          Action: ["kms:Decrypt", "kms:GenerateDataKey"],
          Resource: $credential_key_arn
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
