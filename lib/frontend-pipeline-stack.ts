import { Duration, Stack, StackProps, Fn } from 'aws-cdk-lib';
import { BuildSpec, LinuxBuildImage, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { Repository } from 'aws-cdk-lib/aws-codecommit';
import { Artifact, IAction, Pipeline } from 'aws-cdk-lib/aws-codepipeline';
import {
  CodeBuildAction,
  CodeCommitSourceAction,
  ManualApprovalAction
} from 'aws-cdk-lib/aws-codepipeline-actions';
import { Effect, ManagedPolicy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { RepositoryConfiguration, FrontendDeployment } from './aws-cdk-frontend-pipeline-stack';

export interface FrontendPipelineStackProps extends StackProps, RepositoryConfiguration {
  applicationName: string;
  environments: FrontendDeployment[];
}

export class FrontendPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendPipelineStackProps) {
    super(scope, id, props);
    const { applicationName, repositoryName, branch, environments } = props;

    const pipeline = new Pipeline(this, 'PipelineGui', {
      pipelineName: applicationName,
      crossAccountKeys: true,
    });

    // Source
    const sourceOutput = new Artifact();
    const sourceAction = getSourceAction(
      repositoryName,
      branch,
      sourceOutput,
      this,
    );

    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Build
    // Add every environment
    environments.sort(compare).forEach((environment) => {
      const stack = environment.stack;
      const buildOutputTest = new Artifact(`Artifact-${stack}`);
      const buildCmd = `REACT_APP_STAGE=${stack} npm run build`;
      const buildAction = new CodeBuildAction({
        actionName: `CodeBuild-${stack}`,
        input: sourceOutput,
        outputs: [buildOutputTest],
        project: new PipelineProject(this, `Project-${stack}`, {
          timeout: Duration.minutes(15),
          environment: {
            buildImage: LinuxBuildImage.STANDARD_6_0,
          },
          buildSpec: BuildSpec.fromObject({
            version: '0.2',
            phases: {
              install: {
                commands: 'npm install',
              },
              build: {
                commands: [buildCmd],
              },
            },
            artifacts: {
              files: '**/*',
              'base-directory': 'build',
            },
          }),
        }),
      });
      pipeline.addStage({
        stageName: `Build-${stack}`,
        actions: [buildAction],
      });

      if (environment.manualApproval) {
        pipeline.addStage({
          stageName: `Approve-${stack}`,
          actions: [
            new ManualApprovalAction({
              actionName: `Approve-${stack}`,
            }),
          ],
        });
      }

      const deployAction = new CodeBuildAction({
        actionName: `${stack}-deployment`,
        input: buildOutputTest,
        project: deployToEnv(this, applicationName, stack),
      });
      pipeline.addStage({
        stageName: `Deploy-${stack}`,
        actions: [deployAction],
      });
    });
  }
}

const deployToEnv = (construct: Construct, applicationName: string, stack: string): PipelineProject => {
  const bucketName = `${applicationName.toLowerCase()}-${stack.toLowerCase()}-frontend-bucket-source`;
  const envPipeline = new PipelineProject(construct, `PipelineProject-${stack}`, {
    timeout: Duration.minutes(15),
    environment: {
      buildImage: LinuxBuildImage.STANDARD_6_0,
    },
    buildSpec: BuildSpec.fromObject({
      version: '0.2',
      phases: {
        post_build: {
          commands: ['aws s3 sync --sse --acl bucket-owner-full-control ./ s3://$BUCKET_NAME'],
        },
      },
    }),
    environmentVariables: {
      BUCKET_NAME: { value: bucketName.toLowerCase() },
    },
  });

  // Add permissions to Project to access S3 bucket and Cloudfront distribution
  envPipeline.role?.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));
  envPipeline.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      resources: ['*'],
      actions: ['s3:List*', 's3:GetObject*', 's3:DeleteObject', 's3:PutObject', 's3:PutObjectAcl'],
    }),
  );

  return envPipeline;
};

const getCodeCommit = (repositoryName: string, branch: string, output: Artifact, construct: Construct): IAction => {
  return new CodeCommitSourceAction({
    actionName: 'CodeCommit',
    repository: Repository.fromRepositoryName(construct, 'RepositoryGui', repositoryName),
    branch,
    output,
  });
};

export const getSourceAction = (
  repository: string,
  branch: string,
  output: Artifact,
  construct: Construct,
): IAction => {
  return getCodeCommit(repository, branch, output, construct);
};

function compare(a: FrontendDeployment, b: FrontendDeployment) {
  return a.deploymentOrder - b.deploymentOrder;
}
