/**
 * CDK Stack Tests
 * 
 * Tests CDK stack synthesis and resource creation.
 * 
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.4**
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { IoTProximityAlertStack } from '../lib/iot-proximity-alert-stack';

describe('IoTProximityAlertStack', () => {
  let app: cdk.App;
  let stack: IoTProximityAlertStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    stack = new IoTProximityAlertStack(app, 'TestStack', {
      environment: 'test',
      vehicleHandheldTableName: 'TestVehicle2HandheldTable',
      notificationTopicArn: 'arn:aws:sns:us-east-1:123456789012:TestTopic',
    });
    template = Template.fromStack(stack);
  });

  describe('Stack synthesis', () => {
    it('should synthesize successfully', () => {
      expect(() => app.synth()).not.toThrow();
    });

    it('should create stack with correct properties', () => {
      expect(stack.stackName).toBe('TestStack');
    });

    it('should create stack with default props when none provided', () => {
      const defaultApp = new cdk.App();
      const defaultStack = new IoTProximityAlertStack(defaultApp, 'DefaultStack');
      
      expect(() => defaultApp.synth()).not.toThrow();
      expect(defaultStack.stackName).toBe('DefaultStack');
      
      // Verify default values are used
      const defaultTemplate = Template.fromStack(defaultStack);
      
      // Should use default table name
      defaultTemplate.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            VEHICLE_HANDHELD_TABLE_NAME: 'Vehicle2HandheldTable',
          },
        },
      });
    });
  });

  describe('S3 Buckets', () => {
    it('should create event storage bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      });
    });

    it('should create report storage bucket', () => {
      template.resourceCountIs('AWS::S3::Bucket', 2);
    });
  });

  describe('Lambda Function', () => {
    it('should create batch processor Lambda', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs24.x',
        MemorySize: 3008,
        Timeout: 900,
        Architectures: ['x86_64'],
        TracingConfig: {
          Mode: 'Active',
        },
      });
    });

    it('should configure environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            DISTANCE_THRESHOLD_METERS: '50',
            VEHICLE_STATIC_THRESHOLD_METERS: '10',
            VEHICLE_STATIC_THRESHOLD_SECONDS: '120',
            VEHICLE_STALENESS_THRESHOLD_SECONDS: '300',
            ENVIRONMENT: 'test',
          },
        },
      });
    });
  });

  describe('SQS Queues', () => {
    it('should create dead letter queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        MessageRetentionPeriod: 1209600, // 14 days
      });
    });

    it('should create IoT Firehose error queue', () => {
      template.resourceCountIs('AWS::SQS::Queue', 2);
    });
  });

  describe('Kinesis Firehose', () => {
    it('should create delivery stream', () => {
      template.hasResourceProperties('AWS::KinesisFirehose::DeliveryStream', {
        DeliveryStreamType: 'DirectPut',
        ExtendedS3DestinationConfiguration: {
          CompressionFormat: 'GZIP',
          BufferingHints: {
            SizeInMBs: 5,
            IntervalInSeconds: 300,
          },
        },
      });
    });
  });

  describe('IoT Core Rule', () => {
    it('should create IoT topic rule', () => {
      template.hasResourceProperties('AWS::IoT::TopicRule', {
        TopicRulePayload: {
          Sql: "SELECT * FROM 'v1/gps/+/#'",
          AwsIotSqlVersion: '2016-03-23',
          RuleDisabled: false,
        },
      });
    });

    it('should configure error action for IoT rule', () => {
      template.hasResourceProperties('AWS::IoT::TopicRule', {
        TopicRulePayload: {
          ErrorAction: {
            Sqs: {
              UseBase64: false,
            },
          },
        },
      });
    });
  });

  describe('EventBridge Schedule', () => {
    it('should create daily schedule', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: 'cron(0 2 * * ? *)',
      });
    });
  });

  describe('CloudWatch Alarms', () => {
    it('should create processing duration alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Threshold: 3000,
        ComparisonOperator: 'GreaterThanThreshold',
        ExtendedStatistic: 'p95',
      });
    });

    it('should create DLQ alarm', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Threshold: 0,
        ComparisonOperator: 'GreaterThanThreshold',
      });
    });

    it('should create at least 4 alarms', () => {
      template.resourceCountIs('AWS::CloudWatch::Alarm', 4);
    });
  });

  describe('IAM Permissions', () => {
    it('should grant Lambda S3 read permissions on event bucket', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const hasS3ReadPermissions = Object.values(policies).some((policy: any) => {
        const statements = policy.Properties?.PolicyDocument?.Statement || [];
        return statements.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.some((action: string) => 
            action.includes('s3:GetObject') || action.includes('s3:GetBucket') || action.includes('s3:List')
          );
        });
      });
      expect(hasS3ReadPermissions).toBe(true);
    });

    it('should grant Lambda DynamoDB scan permissions', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const hasDynamoDBScanPermissions = Object.values(policies).some((policy: any) => {
        const statements = policy.Properties?.PolicyDocument?.Statement || [];
        return statements.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.includes('dynamodb:Scan');
        });
      });
      expect(hasDynamoDBScanPermissions).toBe(true);
    });

    it('should grant Lambda SNS publish permissions', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const hasSNSPublishPermissions = Object.values(policies).some((policy: any) => {
        const statements = policy.Properties?.PolicyDocument?.Statement || [];
        return statements.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.includes('sns:Publish');
        });
      });
      expect(hasSNSPublishPermissions).toBe(true);
    });
  });

  describe('Stack Outputs', () => {
    it('should export event bucket name', () => {
      template.hasOutput('EventBucketName', {});
    });

    it('should export report bucket name', () => {
      template.hasOutput('ReportBucketName', {});
    });

    it('should export Lambda function name', () => {
      template.hasOutput('BatchProcessorFunctionName', {});
    });

    it('should export DLQ URL', () => {
      template.hasOutput('DeadLetterQueueUrl', {});
    });

    it('should export Firehose stream name', () => {
      template.hasOutput('FirehoseStreamName', {});
    });
  });
});
