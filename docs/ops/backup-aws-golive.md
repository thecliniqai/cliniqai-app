# FT-02 backup on AWS (`ap-south-1`): go-live option (not wired)

> **Status: design only, not deployed, not in CI.** PO decision 2026-11-13: staging backups go to Cloudflare R2 through
> the GitHub Actions workflow `.github/workflows/backup.yml` (runbook `docs/runbooks/backup-restore.md`); AWS Mumbai
> is decided at go-live (V2-15, production FT-02). This page keeps the AWS design written in V2-04 04-05a so go-live
> starts from a reviewed template instead of a blank page. Nothing here runs today.

## Why it existed

Roadmap FT-02 / PO-23(h): the production backup runs in AWS `ap-south-1`, never on a GitHub-hosted runner (real patient
data), with an age-encrypted dump in a versioned SSE-KMS bucket, a 30-day lifecycle, an alert on a failed run and on a
missing run, and tool-produced evidence through a read-only role. R2 is used for staging only (synthetic data); for
production the residency and the "not on a shared CI runner" requirements bring this design back.

## Design (one CloudFormation stack per environment, deployed by the PO from CloudShell)

| Resource | Setting |
|---|---|
| `AWS::KMS::Key` + alias `alias/clinicos-<env>-backup` | customer-managed, rotation on, retained on stack deletion |
| `AWS::S3::Bucket` `clinicos-<env>-backup-<account>` | versioning on; default SSE-KMS with that key, bucket key on; all four Block Public Access flags; `BucketOwnerEnforced`; lifecycle rule 1 `ExpirationInDays 30` + `NoncurrentVersionExpiration 1 day`, rule 2 `ExpiredObjectDeleteMarker true` (two rules: S3 refuses both in one rule); retained |
| `AWS::S3::BucketPolicy` | deny `s3:*` when `aws:SecureTransport = false` (bucket and objects) |
| `AWS::CodeBuild::Project` `clinicos-<env>-backup` | `aws/codebuild/amazonlinux-x86_64-standard:5.0`, privileged (Docker), 60 min; plaintext env `BACKUP_ENV`, bucket, prefix, recipients; `PARAMETER_STORE` for the DB URL and the Storage S3 endpoint/region/key/secret under `/clinicos/<env>/backup/`; buildspec embeds `ops/backup/backup.sh`, `ops/bin/install-age.sh`, `ops/bin/psql-docker.sh`, `ops/bin/psql-restricted.sh`, `ops/bin/pins.env` as base64 lines (comment lines stripped; deterministic) and sets `s3.multipart_threshold 5GB` so the writer needs `kms:GenerateDataKey` only |
| Writer role (CodeBuild) | `s3:PutObject` on `<bucket>/<env>/*` only (no Get, no Delete, no List), `kms:GenerateDataKey` on the key, `ssm:GetParameters` on the parameter path, logs on its group; trust `codebuild.amazonaws.com` with `aws:SourceAccount` |
| `AWS::Scheduler::Schedule` | `cron(0 2,14 * * ? *)`, `Asia/Kolkata`, flexible window off, retry 2 attempts / 3600 s, role with `codebuild:StartBuild` on the project only |
| `AWS::Events::Rule` | `CodeBuild Build State Change` with `FAILED`, `TIMED_OUT`, `STOPPED` for the project → SNS (input transformer: project, build id, status) |
| `AWS::CloudWatch::Alarm` | `AWS/CodeBuild SucceededBuilds` Sum < 1, period 21600 s, 3 of 3, `TreatMissingData: breaching` → SNS (a schedule that never fires) |
| `AWS::SNS::Topic` + email subscription | ops inbox; topic policy for `events` and `cloudwatch` with `aws:SourceAccount` |
| Log group | `/aws/codebuild/clinicos-<env>-backup`, 30 days |
| GitHub OIDC provider (conditional) + evidence role | trust `repo:<owner/repo>:environment:<GitHubEnvironment>` with `aud = sts.amazonaws.com`; bucket-level list/config reads, build history, log lines, metrics; **no object read** |

Parameters: `Environment` (staging|production), `AgeRecipients` (two or more `age1…`), `AlertEmail`,
`GitHubRepository`, `GitHubEnvironment` (default `staging-readonly`), `CreateGitHubOidcProvider`. Outputs: `BucketName`,
`EvidenceRoleArn`, `TopicArn`, `ProjectName`, `ScheduleName`.

Validated on 2026-11-13 (04-05a, before the R2 decision): the rendered JSON was 42,849 bytes (limit 51,200 for a direct
`aws cloudformation deploy` upload) and `cfn-lint 1.59.0 --regions ap-south-1` (throwaway `python:3.12-slim`
container, no AWS call) reported no error or warning. Policy assertions existed as a spec on the rendered template.

## Known issue to solve at go-live

The evidence workflow needs `id-token: write` in a job of Environment `staging-readonly` (or a production equivalent),
and `scripts/ci/workflow-policy.mjs` refuses every `write` scope in a staging workflow (`staging-read-only-token`). A
narrow allowance (job-level `id-token: write` only, in that Environment, no other write scope) with policy spec cases
is needed before such a workflow can land.

## Bringing it back (V2-15)

1. Restore `ops/backup/stack.template.ts` from the appendix below, add `ops/backup/render.ts` (reads the four embedded
   files, strips whole-line `#` comments outside heredoc bodies, renders `JSON.stringify(template, null, 1)`, refuses
   > 51,200 bytes, `--check` for CI, `--check-recipients` for the PO's two `age1…` lines) and the policy spec.
2. `backup.sh` already targets any S3-compatible endpoint through `BACKUP_S3_*`; for CodeBuild either add a role-
   credentials mode (no static keys) or keep static keys in SSM. Decide with the go-live security review.
3. Production age key pairs are separate from staging (R-3); the production restore drill machine is R-42 (V2-15).

## Appendix: `ops/backup/stack.template.ts` as written in 04-05a

```ts
/**
 * FT-02 backup stack as code (V2-04 04-05a; rulings R-3, R-14, R-30; threats T-04-11, T-04-12, T-04-15).
 *
 * Builds the CloudFormation template (JSON) for one environment's backup: a customer-managed KMS key; a versioned,
 * SSE-KMS, non-public, TLS-only bucket whose only expiry is the 30-day lifecycle (noncurrent versions 1 day, expired
 * delete markers removed); a CodeBuild project that runs ops/backup/backup.sh (embedded by render.ts) with a writer
 * role that can only PutObject under `<env>/`; an EventBridge Scheduler schedule at 02:00 and 14:00 Asia/Kolkata; an SNS
 * email topic fed by a failed/timed-out/stopped-build rule and a "no successful build in 18 h" alarm; and a GitHub OIDC
 * evidence role (one GitHub Environment) that can list names, sizes and configuration, never read an object.
 *
 * The PO deploys it from CloudShell (04-P5); Claude never holds AWS credentials (R-14). No AWS call happens here.
 */

export interface EmbeddedFiles {
  /** ops/bin/pins.env */
  pins: string;
  /** ops/bin/install-age.sh */
  installAge: string;
  /** ops/bin/psql-docker.sh */
  psqlDocker: string;
  /** ops/bin/psql-restricted.sh (04-07e: backup.sh runs every psql session through it) */
  psqlRestricted: string;
  /** ops/backup/backup.sh */
  backupSh: string;
}

/** age X25519 recipient: `age1` + 58 bech32 characters. */
export const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;
export const AGE_RECIPIENTS_PATTERN = "^age1[02-9ac-hj-np-z]{58}(,age1[02-9ac-hj-np-z]{58})+$";

export const SCHEDULE_EXPRESSION = "cron(0 2,14 * * ? *)";
export const SCHEDULE_TIMEZONE = "Asia/Kolkata";
export const FAILURE_STATUSES = ["FAILED", "TIMED_OUT", "STOPPED"] as const;
export const SSM_PARAMETERS = {
  DB_URL: "db_url",
  STORAGE_S3_ENDPOINT: "storage_s3_endpoint",
  STORAGE_S3_REGION: "storage_s3_region",
  STORAGE_S3_KEY_ID: "storage_s3_key_id",
  STORAGE_S3_SECRET: "storage_s3_secret",
} as const;
/** CloudFormation's direct (non-S3) template upload limit for `aws cloudformation deploy --template-file`. */
export const TEMPLATE_MAX_BYTES = 51_200;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const sub = (s: string): Json => ({ "Fn::Sub": s });
const ref = (name: string): Json => ({ Ref: name });
const getAtt = (resource: string, attr: string): Json => ({ "Fn::GetAtt": [resource, attr] });

const NAME = "clinicos-${Environment}-backup";

/** Deterministic buildspec lines that recreate one file from its base64 text. */
function embed(path: string, content: string): string[] {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  return [`printf '%s' '${b64}' | base64 -d > ${path}`];
}

export function buildspec(files: EmbeddedFiles): string {
  const install = [
    "mkdir -p ops/bin ops/backup",
    ...embed("ops/bin/pins.env", files.pins),
    ...embed("ops/bin/install-age.sh", files.installAge),
    ...embed("ops/bin/psql-docker.sh", files.psqlDocker),
    ...embed("ops/bin/psql-restricted.sh", files.psqlRestricted),
    ...embed("ops/backup/backup.sh", files.backupSh),
    "chmod 0755 ops/bin/install-age.sh ops/bin/psql-docker.sh ops/bin/psql-restricted.sh ops/backup/backup.sh",
    "OPS_BIN_DIR=\"$PWD/.cache/ops-bin\" bash ops/bin/install-age.sh",
    // Single PUT up to 5 GB: the writer role needs kms:GenerateDataKey only (multipart SSE-KMS would need kms:Decrypt).
    "aws configure set default.s3.multipart_threshold 5GB",
  ];
  const lines = [
    "version: 0.2",
    "env:",
    "  shell: bash",
    "phases:",
    "  install:",
    "    runtime-versions:",
    "      nodejs: 22",
    "    commands:",
    ...install.map((c) => `      - ${JSON.stringify(c)}`),
    "  build:",
    "    commands:",
    `      - ${JSON.stringify("AGE_BIN=\"$PWD/.cache/ops-bin/age\" bash ops/backup/backup.sh")}`,
  ];
  return lines.join("\n") + "\n";
}

export function buildTemplate(files: EmbeddedFiles): Record<string, Json> {
  const bucketArn = getAtt("BackupBucket", "Arn");
  const projectArn = getAtt("BackupProject", "Arn");
  const logGroupArn = getAtt("BuildLogGroup", "Arn");
  const ssmPath = "arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter/clinicos/${Environment}/backup/";

  const parameterStoreVars: Json[] = Object.entries(SSM_PARAMETERS).map(([name, param]) => ({
    Name: name,
    Type: "PARAMETER_STORE",
    Value: sub(`/clinicos/\${Environment}/backup/${param}`),
  }));

  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "clinicOS FT-02 backup (V2-04 04-05a): age-encrypted Supabase dump + Storage sync twice a day to a versioned SSE-KMS bucket in ap-south-1. Generated by ops/backup/render.ts; do not edit by hand.",
    Parameters: {
      Environment: { Type: "String", AllowedValues: ["staging", "production"], Description: "Backup environment." },
      AgeRecipients: {
        Type: "String",
        AllowedPattern: AGE_RECIPIENTS_PATTERN,
        Description: "Two or more age1... PUBLIC recipients, comma separated (primary, break-glass; R-3). Never a private key.",
      },
      AlertEmail: {
        Type: "String",
        AllowedPattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
        Description: "Monitored ops inbox (04-P7) for backup failure emails.",
      },
      GitHubRepository: {
        Type: "String",
        AllowedPattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$",
        Description: "owner/repo allowed to assume the evidence role.",
      },
      GitHubEnvironment: {
        Type: "String",
        Default: "staging-readonly",
        AllowedPattern: "^[A-Za-z0-9_.-]+$",
        Description: "The only GitHub Environment whose jobs may assume the evidence role.",
      },
      CreateGitHubOidcProvider: {
        Type: "String",
        AllowedValues: ["true", "false"],
        Default: "true",
        Description: "false when the account already has the token.actions.githubusercontent.com provider.",
      },
    },
    Conditions: {
      CreateOidcProvider: { "Fn::Equals": [ref("CreateGitHubOidcProvider"), "true"] },
    },
    Resources: {
      BackupKey: {
        Type: "AWS::KMS::Key",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          Description: sub("clinicOS ${Environment} backup bucket key (SSE-KMS)"),
          EnableKeyRotation: true,
          KeyPolicy: {
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "AccountAdministersKeyAndDelegatesUseToIam",
                Effect: "Allow",
                Principal: { AWS: sub("arn:${AWS::Partition}:iam::${AWS::AccountId}:root") },
                Action: "kms:*",
                Resource: "*",
              },
            ],
          },
        },
      },
      BackupKeyAlias: {
        Type: "AWS::KMS::Alias",
        Properties: { AliasName: sub(`alias/${NAME}`), TargetKeyId: ref("BackupKey") },
      },
      BackupBucket: {
        Type: "AWS::S3::Bucket",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          BucketName: sub(`${NAME}-\${AWS::AccountId}`),
          VersioningConfiguration: { Status: "Enabled" },
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              {
                ServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: getAtt("BackupKey", "Arn") },
                BucketKeyEnabled: true,
              },
            ],
          },
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
          OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
          // Two rules: S3 refuses Expiration days and ExpiredObjectDeleteMarker in one rule (research A10).
          LifecycleConfiguration: {
            Rules: [
              {
                Id: "expire-after-30-days",
                Status: "Enabled",
                ExpirationInDays: 30,
                NoncurrentVersionExpiration: { NoncurrentDays: 1 },
              },
              { Id: "remove-expired-delete-markers", Status: "Enabled", ExpiredObjectDeleteMarker: true },
            ],
          },
        },
      },
      BackupBucketPolicy: {
        Type: "AWS::S3::BucketPolicy",
        Properties: {
          Bucket: ref("BackupBucket"),
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "DenyInsecureTransport",
                Effect: "Deny",
                Principal: "*",
                Action: "s3:*",
                Resource: [bucketArn, { "Fn::Join": ["", [bucketArn, "/*"]] }],
                Condition: { Bool: { "aws:SecureTransport": "false" } },
              },
            ],
          },
        },
      },
      AlertTopic: {
        Type: "AWS::SNS::Topic",
        Properties: { TopicName: sub(`${NAME}-alerts`), DisplayName: "clinicOS backup" },
      },
      AlertTopicPolicy: {
        Type: "AWS::SNS::TopicPolicy",
        Properties: {
          Topics: [ref("AlertTopic")],
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "EventBridgeAndCloudWatchPublish",
                Effect: "Allow",
                Principal: { Service: ["events.amazonaws.com", "cloudwatch.amazonaws.com"] },
                Action: "sns:Publish",
                Resource: ref("AlertTopic"),
                Condition: { StringEquals: { "aws:SourceAccount": ref("AWS::AccountId") } },
              },
            ],
          },
        },
      },
      AlertSubscription: {
        Type: "AWS::SNS::Subscription",
        Properties: { TopicArn: ref("AlertTopic"), Protocol: "email", Endpoint: ref("AlertEmail") },
      },
      BuildLogGroup: {
        Type: "AWS::Logs::LogGroup",
        Properties: { LogGroupName: sub(`/aws/codebuild/${NAME}`), RetentionInDays: 30 },
      },
      BackupWriterRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: sub(`${NAME}-writer`),
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "codebuild.amazonaws.com" },
                Action: "sts:AssumeRole",
                Condition: { StringEquals: { "aws:SourceAccount": ref("AWS::AccountId") } },
              },
            ],
          },
          Policies: [
            {
              PolicyName: "backup-writer",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Sid: "PutArchivesUnderTheEnvironmentPrefixOnly",
                    Effect: "Allow",
                    Action: ["s3:PutObject"],
                    Resource: { "Fn::Join": ["", [bucketArn, sub("/${Environment}/*")]] },
                  },
                  {
                    Sid: "EncryptWithTheBucketKey",
                    Effect: "Allow",
                    Action: ["kms:GenerateDataKey"],
                    Resource: getAtt("BackupKey", "Arn"),
                  },
                  {
                    Sid: "ReadBackupParameters",
                    Effect: "Allow",
                    Action: ["ssm:GetParameters"],
                    Resource: sub(`${ssmPath}*`),
                  },
                  {
                    Sid: "WriteBuildLogs",
                    Effect: "Allow",
                    Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
                    Resource: [logGroupArn, { "Fn::Join": ["", [logGroupArn, ":*"]] }],
                  },
                ],
              },
            },
          ],
        },
      },
      BackupProject: {
        Type: "AWS::CodeBuild::Project",
        Properties: {
          Name: sub(NAME),
          Description: "FT-02 backup: Supabase dump + Storage sync, age-encrypted, uploaded to the backup bucket.",
          ServiceRole: getAtt("BackupWriterRole", "Arn"),
          Artifacts: { Type: "NO_ARTIFACTS" },
          Source: { Type: "NO_SOURCE", BuildSpec: buildspec(files) },
          TimeoutInMinutes: 60,
          QueuedTimeoutInMinutes: 60,
          Environment: {
            Type: "LINUX_CONTAINER",
            ComputeType: "BUILD_GENERAL1_SMALL",
            Image: "aws/codebuild/amazonlinux-x86_64-standard:5.0",
            PrivilegedMode: true,
            EnvironmentVariables: [
              { Name: "BACKUP_ENV", Type: "PLAINTEXT", Value: ref("Environment") },
              { Name: "TARGET_BUCKET", Type: "PLAINTEXT", Value: ref("BackupBucket") },
              { Name: "TARGET_PREFIX", Type: "PLAINTEXT", Value: sub("${Environment}/") },
              { Name: "AGE_RECIPIENTS", Type: "PLAINTEXT", Value: ref("AgeRecipients") },
              ...parameterStoreVars,
            ],
          },
          LogsConfig: { CloudWatchLogs: { Status: "ENABLED", GroupName: ref("BuildLogGroup") } },
        },
      },
      SchedulerRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: sub(`${NAME}-scheduler`),
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "scheduler.amazonaws.com" },
                Action: "sts:AssumeRole",
                Condition: { StringEquals: { "aws:SourceAccount": ref("AWS::AccountId") } },
              },
            ],
          },
          Policies: [
            {
              PolicyName: "start-backup-build",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [{ Effect: "Allow", Action: ["codebuild:StartBuild"], Resource: projectArn }],
              },
            },
          ],
        },
      },
      BackupSchedule: {
        Type: "AWS::Scheduler::Schedule",
        Properties: {
          Name: sub(NAME),
          Description: "FT-02: backup at 02:00 and 14:00 India time.",
          ScheduleExpression: SCHEDULE_EXPRESSION,
          ScheduleExpressionTimezone: SCHEDULE_TIMEZONE,
          FlexibleTimeWindow: { Mode: "OFF" },
          State: "ENABLED",
          Target: {
            Arn: projectArn,
            RoleArn: getAtt("SchedulerRole", "Arn"),
            RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
          },
        },
      },
      BuildFailureRule: {
        Type: "AWS::Events::Rule",
        Properties: {
          Name: sub(`${NAME}-failed`),
          Description: "Email when a backup build fails, times out or is stopped.",
          State: "ENABLED",
          EventPattern: {
            source: ["aws.codebuild"],
            "detail-type": ["CodeBuild Build State Change"],
            detail: { "build-status": [...FAILURE_STATUSES], "project-name": [ref("BackupProject")] },
          },
          Targets: [
            {
              Id: "backup-failure-email",
              Arn: ref("AlertTopic"),
              InputTransformer: {
                InputPathsMap: { project: "$.detail.project-name", build: "$.detail.build-id", status: "$.detail.build-status" },
                InputTemplate: "\"clinicOS backup <status>: project <project>, build <build>\"",
              },
            },
          ],
        },
      },
      MissingBackupAlarm: {
        Type: "AWS::CloudWatch::Alarm",
        Properties: {
          AlarmName: sub(`${NAME}-missing`),
          AlarmDescription: "No successful backup build in 18 hours (a schedule that never fired, or every run failing).",
          Namespace: "AWS/CodeBuild",
          MetricName: "SucceededBuilds",
          Dimensions: [{ Name: "ProjectName", Value: ref("BackupProject") }],
          Statistic: "Sum",
          Period: 21600,
          EvaluationPeriods: 3,
          DatapointsToAlarm: 3,
          Threshold: 1,
          ComparisonOperator: "LessThanThreshold",
          TreatMissingData: "breaching",
          AlarmActions: [ref("AlertTopic")],
        },
      },
      GitHubOidcProvider: {
        Type: "AWS::IAM::OIDCProvider",
        Condition: "CreateOidcProvider",
        Properties: {
          Url: "https://token.actions.githubusercontent.com",
          ClientIdList: ["sts.amazonaws.com"],
          // AWS validates GitHub's OIDC endpoint through its own trusted CAs; the list is kept for older accounts.
          ThumbprintList: ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"],
        },
      },
      EvidenceRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: sub(`${NAME}-evidence`),
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: {
                  Federated: {
                    "Fn::If": [
                      "CreateOidcProvider",
                      ref("GitHubOidcProvider"),
                      sub("arn:${AWS::Partition}:iam::${AWS::AccountId}:oidc-provider/token.actions.githubusercontent.com"),
                    ],
                  },
                },
                Action: "sts:AssumeRoleWithWebIdentity",
                Condition: {
                  StringEquals: {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                    "token.actions.githubusercontent.com:sub": sub("repo:${GitHubRepository}:environment:${GitHubEnvironment}"),
                  },
                },
              },
            ],
          },
          Policies: [
            {
              PolicyName: "backup-evidence-read-only",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Sid: "BucketListingAndConfigurationOnly",
                    Effect: "Allow",
                    Action: [
                      "s3:ListBucket",
                      "s3:ListBucketVersions",
                      "s3:GetBucketVersioning",
                      "s3:GetLifecycleConfiguration",
                      "s3:GetEncryptionConfiguration",
                      "s3:GetBucketPublicAccessBlock",
                      "s3:GetBucketPolicyStatus",
                      "s3:GetBucketLocation",
                    ],
                    Resource: bucketArn,
                  },
                  {
                    Sid: "BuildHistory",
                    Effect: "Allow",
                    Action: ["codebuild:ListBuildsForProject", "codebuild:BatchGetBuilds"],
                    Resource: projectArn,
                  },
                  {
                    Sid: "BuildLogLines",
                    Effect: "Allow",
                    Action: ["logs:FilterLogEvents"],
                    Resource: [logGroupArn, { "Fn::Join": ["", [logGroupArn, ":*"]] }],
                  },
                  {
                    Sid: "DeliveryMetrics",
                    Effect: "Allow",
                    Action: ["cloudwatch:GetMetricStatistics"],
                    Resource: "*",
                  },
                ],
              },
            },
          ],
        },
      },
    },
    Outputs: {
      BucketName: { Value: ref("BackupBucket") },
      EvidenceRoleArn: { Value: getAtt("EvidenceRole", "Arn") },
      TopicArn: { Value: ref("AlertTopic") },
      ProjectName: { Value: ref("BackupProject") },
      ScheduleName: { Value: ref("BackupSchedule") },
    },
  };
}
```
