import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { Repository } from 'aws-cdk-lib/aws-codecommit';
import { FrontendInfrastructureStage } from './frontend-infrastructure-stage';
import { FrontendPipelineStage } from './frontend-pipeline-stage';
import { LinuxBuildImage } from 'aws-cdk-lib/aws-codebuild';

export interface Route53ImportConfig {
  domainNameImportValue: string,
  hostedZoneIdImportValue: string,
};

export interface Route53StaticConfig {
  domainName: string,
  hostedZoneId: string,
};

export interface RepositoryConfiguration {
  repositoryName: string;
  branch: string;
};

export interface FrontendDeployment {
  deploymentOrder: number,
  accountNumber: string,
  region: string,
  stack: string,
  route53?: Route53StaticConfig,
  manualApproval?: boolean,
}

export interface FrontendConfiguration extends RepositoryConfiguration {
  environments: FrontendDeployment[],
};

export interface AppConfiguration {
  ciCd: {
    accountNumber: string,
    region: string,
  },
  applicationName: string;
  infrastructure: RepositoryConfiguration,
  frontend: FrontendConfiguration,
  route53?: Route53ImportConfig,
}

export interface AwsCdkFrontendPipelineStackProps extends StackProps {
  configuration: AppConfiguration
}

export class AwsCdkFrontendPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: AwsCdkFrontendPipelineStackProps) {
    super(scope, id, props);
    const { applicationName, infrastructure, frontend, route53, ciCd } = props.configuration;

    const repository = Repository.fromRepositoryName(this, 'Repository', infrastructure.repositoryName);

    const input = CodePipelineSource.codeCommit(repository, infrastructure.branch);

    // The basic pipeline declaration. This sets the initial structure of our pipeline
    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: `${applicationName}-infrastructure`,
      crossAccountKeys: true,
      codeBuildDefaults: {
        timeout: Duration.minutes(15),
        buildEnvironment: {
          buildImage: LinuxBuildImage.STANDARD_6_0,
        },
      },
      synth: new ShellStep('Synth', {
        input,
        commands: [
          'mv -f .npmrc_ci .npmrc 2>/dev/null; true',
          'npm ci',
          'npm run build',
          'npx cdk synth'
        ],
      }),
      synthCodeBuildDefaults: {
        timeout: Duration.minutes(15),
      },
    });

    // Deploy the infrastructure to all Environments
    frontend.environments.forEach((deployment) => {
      const env = new FrontendInfrastructureStage(this, `${applicationName}-Infrastructure-${deployment.stack}`, {
        env: { account: deployment.accountNumber, region: deployment.region },
        applicationName,
        stack: deployment.stack,
        ciCdAccount: ciCd.accountNumber,
        ...(route53 && { route53: route53 }),
        ...(deployment.route53 && { route53: deployment.route53 }),
      });
      pipeline.addStage(env);
    });

    // Deploy the Frontend pipeline
    const frontendPipeline = new FrontendPipelineStage(this, `${applicationName}-Frontend-Pipeline`, {}, {
      applicationName: applicationName,
      deployments: frontend.environments,
      repositoryName: frontend.repositoryName,
      branch: frontend.branch,
      stack: 'Production',
    });
    pipeline.addStage(frontendPipeline);
  }
}
