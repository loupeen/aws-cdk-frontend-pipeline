import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FrontendPipelineStack } from './frontend-pipeline-stack';
import { RepositoryConfiguration, FrontendDeployment } from './aws-cdk-frontend-pipeline-stack';

interface FrontendPipelineStageProps extends RepositoryConfiguration {
  applicationName: string;
  stack: string;
  deployments: FrontendDeployment[];
}

export class FrontendPipelineStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps, customProps?: FrontendPipelineStageProps) {
    super(scope, id, props);

    if (!props || !customProps) {
      return;
    }

    /* tslint:disable:no-unused-expression */
    new FrontendPipelineStack(this, `Stack`, {
      applicationName: customProps.applicationName,
      environments: customProps.deployments,
      repositoryName: customProps.repositoryName,
      branch: customProps.branch,
    });
  }
}
