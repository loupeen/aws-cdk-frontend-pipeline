import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { FrontendInfrastructureStack } from '../lib/frontend-infrastructure-stack';

test('Basic infrastructure setup', () => {
  const app = new cdk.App();

  // WHEN
  const stack = new FrontendInfrastructureStack(app, "infrastructure", {
    applicationName: "TestApp",
    stack: "Test",
    ciCdAccount: "1234567890",
  });

  // THEN
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Route53::HostedZone', 0);
  template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
});
