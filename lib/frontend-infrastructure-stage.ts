import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FrontendInfrastructureStack } from './frontend-infrastructure-stack';
import { Route53ImportConfig, Route53StaticConfig } from './aws-cdk-frontend-pipeline-stack';

interface PipelineStageProps extends cdk.StageProps {
  applicationName: string;
  stack: string,
  ciCdAccount: string,
  route53?: Route53StaticConfig | Route53ImportConfig
}

export class FrontendInfrastructureStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: PipelineStageProps) {
    super(scope, id, props);

    /* tslint:disable:no-unused-expression */
    new FrontendInfrastructureStack(this, `Stack`, props);
  }
}
