import { AppConfiguration } from "../lib/aws-cdk-frontend-pipeline-stack";

// - - - Configuration with route53 configuration as outputs from other stacks
export const configuration: AppConfiguration = {
  ciCd: {
    accountNumber: '111111111111',
    region: 'eu-north-1',
  },
  applicationName: "MyFrontend",
  infrastructure: {
    repositoryName: "demo-infrastructure",
    branch: "master",
  },
  route53: {
    domainNameImportValue: 'publicHostedZoneName',
    hostedZoneIdImportValue: 'publicHostedZoneId'
  },
  frontend: {
    repositoryName: "demo-frontend",
    branch: "master",
    environments: [{
      deploymentOrder: 1,
      accountNumber: "222222222222",
      region: "eu-north-1",
      stack: "test",
    }, {
      deploymentOrder: 2,
      accountNumber: "333333333333",
      region: "eu-north-1",
      stack: "production",
      manualApproval: true
    }]
  }
};


