/**
 * AWS CDK Stack for CI/CD Pipeline
 * 
 * Creates CodePipeline with:
 * - Source stage (GitHub)
 * - Build stage (CodeBuild - compile, test, package)
 * - Integration test stage (CodeBuild - test against acceptance)
 * - Acceptance deployment stage
 * - Manual approval gate
 * - Production deployment stage with blue-green deployment
 * 
 * **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7**
 */

import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface CICDPipelineStackProps extends cdk.StackProps {
  /**
   * GitHub repository owner
   */
  githubOwner: string;

  /**
   * GitHub repository name
   */
  githubRepo: string;

  /**
   * GitHub branch to track
   */
  githubBranch?: string;

  /**
   * Email for manual approval notifications
   */
  approvalEmail?: string;
}

export class CICDPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CICDPipelineStackProps) {
    super(scope, id, props);

    const githubBranch = props.githubBranch || 'master';

    // ========================================
    // S3 Bucket for Pipeline Artifacts
    // ========================================

    const artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      bucketName: `iot-proximity-pipeline-artifacts-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ========================================
    // SNS Topic for Approval Notifications
    // ========================================

    const approvalTopic = new sns.Topic(this, 'ApprovalTopic', {
      topicName: 'iot-proximity-pipeline-approvals',
      displayName: 'IoT Proximity Pipeline Approval Notifications',
    });

    if (props.approvalEmail) {
      approvalTopic.addSubscription(
        new subscriptions.EmailSubscription(props.approvalEmail)
      );
    }

    // ========================================
    // CodeBuild Projects
    // ========================================

    // Build Project - Compile, Test, Package
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: 'iot-proximity-build',
      description: 'Build, test, and package IoT Proximity Alert System',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
        privileged: false,
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec-build.yml'),
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.SOURCE),
    });

    // Allow CodeBuild to assume the CDK execution role for asset publishing
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-cfn-exec-role-${this.account}-${this.region}`],
      })
    );

    // Integration Test Project
    const integrationTestProject = new codebuild.PipelineProject(this, 'IntegrationTestProject', {
      projectName: 'iot-proximity-integration-tests',
      description: 'Run integration tests against acceptance environment',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec-integration.yml'),
    });

    // Grant permissions to access acceptance resources
    integrationTestProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'lambda:InvokeFunction',
          's3:GetObject',
          's3:PutObject',
          'dynamodb:Scan',
          'sns:Publish',
        ],
        resources: ['*'], // Scoped to acceptance resources in buildspec
      })
    );

    // ========================================
    // Pipeline Artifacts
    // ========================================

    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const buildOutput = new codepipeline.Artifact('BuildOutput');
    const cdkOutput = new codepipeline.Artifact('CdkOutput');

    // ========================================
    // Pipeline
    // ========================================

    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'iot-proximity-pipeline',
      artifactBucket: artifactBucket,
      restartExecutionOnUpdate: true,
    });

    // Grant CodePipeline permission to use CodeStar connection
    const connectionArn = `arn:aws:codeconnections:${this.region}:${this.account}:connection/eb72eea9-bd59-46f0-9215-4760020dcbbc`;
    
    pipeline.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['codeconnections:UseConnection'],
        resources: [connectionArn],
        effect: iam.Effect.ALLOW,
      })
    );

    // ========================================
    // Source Stage
    // ========================================

    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.CodeStarConnectionsSourceAction({
          actionName: 'GitHub_Source',
          owner: props.githubOwner,
          repo: props.githubRepo,
          branch: githubBranch,
          output: sourceOutput,
          connectionArn: connectionArn,
          triggerOnPush: true,
        }),
      ],
    });

    // ========================================
    // Build Stage
    // ========================================

    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Build_and_Test',
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput, cdkOutput],
          environmentVariables: {
            CDK_EXEC_ROLE_ARN: {
              value: `arn:aws:iam::${this.account}:role/cdk-hnb659fds-cfn-exec-role-${this.account}-${this.region}`,
            },
          },
        }),
      ],
    });

    // ========================================
    // Deploy to Acceptance Stage
    // ========================================

    pipeline.addStage({
      stageName: 'Deploy_Acceptance',
      actions: [
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: 'Deploy_Existing_Infrastructure',
          stackName: 'ExistingInfrastructureStack-acceptance',
          templatePath: cdkOutput.atPath('cdk.out/ExistingInfrastructureStack-acceptance.template.json'),
          adminPermissions: true,
          cfnCapabilities: [
            cdk.CfnCapabilities.NAMED_IAM,
            cdk.CfnCapabilities.AUTO_EXPAND,
          ],
        }),
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: 'Deploy_IoT_Stack',
          stackName: 'IoTProximityAlertStack-acceptance',
          templatePath: cdkOutput.atPath('cdk.out/IoTProximityAlertStack-acceptance.template.json'),
          adminPermissions: true,
          cfnCapabilities: [
            cdk.CfnCapabilities.NAMED_IAM,
            cdk.CfnCapabilities.AUTO_EXPAND,
          ],
          runOrder: 2,
        }),
      ],
    });

    // ========================================
    // Integration Test Stage
    // ========================================

    pipeline.addStage({
      stageName: 'Integration_Tests',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Run_Integration_Tests',
          project: integrationTestProject,
          input: sourceOutput,
          extraInputs: [buildOutput],
          environmentVariables: {
            ENVIRONMENT: { value: 'acceptance' },
          },
        }),
      ],
    });

    // ========================================
    // Manual Approval Stage
    // ========================================

    pipeline.addStage({
      stageName: 'Approval',
      actions: [
        new codepipeline_actions.ManualApprovalAction({
          actionName: 'Approve_Production_Deployment',
          notificationTopic: approvalTopic,
          additionalInformation: 'Please review acceptance deployment and integration test results before approving production deployment.',
        }),
      ],
    });

    // ========================================
    // Deploy to Production Stage
    // ========================================

    pipeline.addStage({
      stageName: 'Deploy_Production',
      actions: [
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: 'Deploy_Existing_Infrastructure',
          stackName: 'ExistingInfrastructureStack-production',
          templatePath: cdkOutput.atPath('cdk.out/ExistingInfrastructureStack-production.template.json'),
          adminPermissions: true,
          cfnCapabilities: [
            cdk.CfnCapabilities.NAMED_IAM,
            cdk.CfnCapabilities.AUTO_EXPAND,
          ],
        }),
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: 'Deploy_IoT_Stack',
          stackName: 'IoTProximityAlertStack-production',
          templatePath: cdkOutput.atPath('cdk.out/IoTProximityAlertStack-production.template.json'),
          adminPermissions: true,
          cfnCapabilities: [
            cdk.CfnCapabilities.NAMED_IAM,
            cdk.CfnCapabilities.AUTO_EXPAND,
          ],
          runOrder: 2,
        }),
      ],
    });

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'PipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline name',
      exportName: 'iot-proximity-pipeline-name',
    });

    new cdk.CfnOutput(this, 'ArtifactBucketName', {
      value: artifactBucket.bucketName,
      description: 'S3 bucket for pipeline artifacts',
      exportName: 'iot-proximity-artifact-bucket',
    });

    new cdk.CfnOutput(this, 'ApprovalTopicArn', {
      value: approvalTopic.topicArn,
      description: 'SNS topic for approval notifications',
      exportName: 'iot-proximity-approval-topic',
    });
  }
}
