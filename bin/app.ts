#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ExistingInfrastructureStack } from '../lib/existing-infrastructure-stack';
import { IoTProximityAlertStack } from '../lib/iot-proximity-alert-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { CICDPipelineStack } from '../lib/ci-cd-pipeline-stack';

const app = new cdk.App();

// Get environment from context or default to production
const environment = app.node.tryGetContext('environment') || 'production';
const notificationEmail = app.node.tryGetContext('notificationEmail');
const githubOwner = app.node.tryGetContext('githubOwner');
const githubRepo = app.node.tryGetContext('githubRepo');
const githubBranch = app.node.tryGetContext('githubBranch') || 'master';

// Stack 1: Existing Infrastructure (DynamoDB + SNS)
// Deploy this FIRST
const existingInfra = new ExistingInfrastructureStack(app, `ExistingInfrastructureStack-${environment}`, {
  environment,
  notificationEmail,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  },
  description: `Existing Infrastructure (DynamoDB + SNS) - ${environment}`,
});

// Stack 2: IoT Proximity Alert System
// Deploy this SECOND (depends on Stack 1)
const iotStack = new IoTProximityAlertStack(app, `IoTProximityAlertStack-${environment}`, {
  environment,
  vehicleHandheldTableName: existingInfra.vehicleHandheldTable.tableName,
  notificationTopicArn: existingInfra.notificationTopic.topicArn,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  },
  description: `IoT Proximity Alert System - ${environment}`,
});

// Ensure IoT stack depends on existing infrastructure
iotStack.addDependency(existingInfra);

// Stack 3: Monitoring Stack
// Deploy this THIRD (depends on Stack 2)
const monitoringStack = new MonitoringStack(app, `MonitoringStack-${environment}`, {
  environment,
  lambdaFunctionName: `iot-proximity-batch-processor-${environment}`,
  eventBucketName: `iot-proximity-events-${process.env.CDK_DEFAULT_ACCOUNT || 'ACCOUNT'}-${environment}`,
  reportBucketName: `iot-proximity-reports-${process.env.CDK_DEFAULT_ACCOUNT || 'ACCOUNT'}-${environment}`,
  dlqName: `iot-proximity-dlq-${environment}`,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  },
  description: `Monitoring and Observability - ${environment}`,
});

monitoringStack.addDependency(iotStack);

// Stack 4: CI/CD Pipeline
// Deploy this separately if you want automated deployments
if (githubOwner && githubRepo) {
  new CICDPipelineStack(app, 'CICDPipelineStack', {
    githubOwner,
    githubRepo,
    githubBranch,
    approvalEmail: notificationEmail,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
    },
    description: 'CI/CD Pipeline for IoT Proximity Alert System',
  });
  
}

app.synth();
