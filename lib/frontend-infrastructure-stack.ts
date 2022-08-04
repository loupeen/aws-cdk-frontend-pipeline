import { Duration, Fn, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { CertificateValidation, DnsValidatedCertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Distribution, OriginAccessIdentity, PriceClass, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AccountPrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { S3EventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, BucketAccessControl, BucketEncryption, EventType } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Route53StaticConfig, Route53ImportConfig } from './aws-cdk-frontend-pipeline-stack';
import path = require('path');

interface FrontendInfrastructureStackProps extends StackProps {
  applicationName: string,
  stack: string,
  ciCdAccount: string,
  route53?: Route53StaticConfig | Route53ImportConfig,
}

function isRoute53StaticConfig(arg: any): arg is Route53StaticConfig {
  return arg && 'domainName' in arg && 'hostedZoneId' in arg;
}

function isRoute53ImportConfig(arg: any): arg is Route53ImportConfig {
  return arg && 'domainNameImportValue' in arg && 'hostedZoneIdImportValue' in arg;
}

export class FrontendInfrastructureStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendInfrastructureStackProps) {
    super(scope, id, props);

    const { applicationName, stack, route53, ciCdAccount } = props;

    // Create a new bucket to store frontend static code
    const bucketSource = new Bucket(this, 'FrontendSourceBucket', {
      bucketName: `${applicationName.toLowerCase()}-${stack.toLowerCase()}-frontend-bucket-source`,
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      accessControl: BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
    });

    // Create a new bucket to store frontend code for CloudFront
    const bucketCloudFront = new Bucket(this, 'FrontendSourceBucketCF', {
      publicReadAccess: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      accessControl: BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
    });

    // Give Ci/Cd account access to crud operations to static code bucket
    bucketSource.grantReadWrite(new AccountPrincipal(ciCdAccount));

    // Give CloudFront read access to CloudFront Bucket
    const originAccessIdentity = new OriginAccessIdentity(this, 'OAI', {});
    bucketCloudFront.grantRead(originAccessIdentity);


    // Get Route53 hostedZone if configured
    let domainName, hostedZone;
    if (isRoute53StaticConfig(route53)) {
      domainName = route53.domainName;
      hostedZone = HostedZone.fromHostedZoneAttributes(this, 'zone', {
        hostedZoneId: route53.hostedZoneId,
        zoneName: domainName,
      });
    } else if (isRoute53ImportConfig(route53)) {
      domainName = Fn.importValue(route53.domainNameImportValue);
      hostedZone = HostedZone.fromHostedZoneAttributes(this, 'zone', {
        hostedZoneId: Fn.importValue(route53.hostedZoneIdImportValue),
        zoneName: domainName,
      });
    }

    // Create certificate
    let certificate;
    if (route53 && domainName && hostedZone) {
      certificate = new DnsValidatedCertificate(this, 'CfCertificate', {
        domainName,
        hostedZone,
        validation: CertificateValidation.fromDns(hostedZone),
        region: 'us-east-1',
      });
    }

    // Create a new CF Distribution to host static frontend app
    const distribution = new Distribution(this, 'CfDistribution', {
      defaultBehavior: {
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        origin: new S3Origin(bucketCloudFront, {
          originAccessIdentity,
        }),
      },
      priceClass: PriceClass.PRICE_CLASS_100,
      domainNames: domainName ? [domainName] : undefined,
      certificate,
      defaultRootObject: 'index.html',
    });

    // Create ARecord if hostedZone is configured.
    if (route53 && domainName && hostedZone) {
      new ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      });
    }

    // Lambda for copy code between buckets.
    const lambdaCopy = new Function(this, 'CopyFunction', {
      functionName: `${applicationName}-frontend-copy-source`,
      runtime: Runtime.PYTHON_3_9,
      handler: 'copyfiles.handler',
      code: Code.fromAsset(path.join(__dirname, '../lambda')),
      environment: {
        readBucket: bucketSource.bucketName,
        writeBucket: bucketCloudFront.bucketName,
      },
      timeout: Duration.seconds(30),
    });
    bucketSource.grantRead(lambdaCopy);
    bucketCloudFront.grantReadWrite(lambdaCopy);

    // Lambda to invalidate cache in CloudFront.
    const lambdaCacheInvalidation = new Function(this, 'CacheInvalidationFunction', {
      functionName: `${applicationName}-frontend-cloudfront-cache-invalidation`,
      runtime: Runtime.PYTHON_3_9,
      handler: 'invalidation.handler',
      code: Code.fromAsset(path.join(__dirname, '../lambda')),
      environment: {
        cfid: distribution.distributionId,
      },
      timeout: Duration.seconds(30),
    });
    bucketSource.grantReadWrite(lambdaCacheInvalidation);
    lambdaCacheInvalidation.role?.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('CloudFrontFullAccess'));

    // Copy event.
    lambdaCopy.addEventSource(
      new S3EventSource(bucketSource, {
        events: [EventType.OBJECT_CREATED, EventType.OBJECT_REMOVED],
        filters: [{ prefix: 'index.html' }],
      }),
    );

    // Cache invalidation event.
    lambdaCacheInvalidation.addEventSource(
      new S3EventSource(bucketCloudFront, {
        events: [EventType.OBJECT_CREATED, EventType.OBJECT_REMOVED],
        filters: [{ prefix: 'index.html' }],
      }),
    );

    // Outputs
    new CfnOutput(this, 'FrontendSourceBucketSource', { value: bucketSource.bucketArn, exportName: `${applicationName}-frontend-bucket-source`, description: `Bucket ARN for ${applicationName} that is used to store the source.` });
    new CfnOutput(this, 'FrontendSourceBucketCloudFront', { value: bucketSource.bucketArn, exportName: `${applicationName}-frontend-bucket-cloudfront`, description: `Bucket ARN for ${applicationName} that is used to store the source that is served by CloudFront.` });
    new CfnOutput(this, 'FrontendDomainName', { value: distribution.domainName, exportName: `${applicationName}-cloudfront-domainName`, description: `Domain name for ${applicationName} that is served by CloudFront.` });
  }
}
