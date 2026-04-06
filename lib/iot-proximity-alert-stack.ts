/**
 * AWS CDK Stack for IoT Proximity Alert System
 * 
 * Creates all infrastructure components:
 * - Kinesis Firehose for event collection
 * - S3 buckets for event and report storage
 * - Lambda function for batch processing
 * - EventBridge schedule for daily triggers
 * - DLQ for failed jobs
 * - CloudWatch alarms for monitoring
 * - IoT Core rule with error action
 * 
 * **Validates: Requirements 11.5, 11.6, 11.7, 11.8**
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as iot from 'aws-cdk-lib/aws-iot';
import { Construct } from 'constructs';

export interface IoTProximityAlertStackProps extends cdk.StackProps {
  /**
   * Existing Vehicle2HandheldTable name
   */
  vehicleHandheldTableName?: string;

  /**
   * Existing Platform Notification Topic ARN
   */
  notificationTopicArn?: string;

  /**
   * Environment name (acceptance, production)
   */
  environment?: string;

  /**
   * S3 bucket containing Lambda code (optional, for pipeline deployments)
   */
  lambdaCodeBucket?: string;

  /**
   * S3 key for Lambda code (optional, for pipeline deployments)
   */
  lambdaCodeKey?: string;
}

export class IoTProximityAlertStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: IoTProximityAlertStackProps) {
    super(scope, id, props);

    const environment = props?.environment || 'production';
    const vehicleHandheldTableName = props?.vehicleHandheldTableName || 'Vehicle2HandheldTable';
    const notificationTopicArn = props?.notificationTopicArn || 
      `arn:aws:sns:${this.region}:${this.account}:Platform_Notification_Topic`;

    // CloudFormation parameters for pipeline deployments
    const lambdaCodeBucketParam = new cdk.CfnParameter(this, 'LambdaCodeBucket', {
      type: 'String',
      default: '',
      description: 'S3 bucket containing Lambda code (leave empty for local deployments)',
    });

    const lambdaCodeKeyParam = new cdk.CfnParameter(this, 'LambdaCodeKey', {
      type: 'String',
      default: '',
      description: 'S3 key for Lambda code (leave empty for local deployments)',
    });

    const lambdaCodeBucket = props?.lambdaCodeBucket || lambdaCodeBucketParam.valueAsString;
    const lambdaCodeKey = props?.lambdaCodeKey || lambdaCodeKeyParam.valueAsString;

    // ========================================
    // S3 Buckets
    // ========================================

    // Event Storage Bucket
    const eventBucket = new s3.Bucket(this, 'EventBucket', {
      bucketName: `iot-proximity-events-${this.account}-${environment}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(0),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Report Storage Bucket
    const reportBucket = new s3.Bucket(this, 'ReportBucket', {
      bucketName: `iot-proximity-reports-${this.account}-${environment}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(365),
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ========================================
    // SQS Queues
    // ========================================

    // Dead Letter Queue for failed batch jobs
    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: `iot-proximity-dlq-${environment}`,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.seconds(30),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // IoT Firehose Error Queue
    const iotFirehoseErrorQueue = new sqs.Queue(this, 'IoTFirehoseErrorQueue', {
      queueName: `iot-firehose-error-queue-${environment}`,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.seconds(30),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // ========================================
    // IAM Roles
    // ========================================

    // Firehose Role
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      inlinePolicies: {
        S3WritePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['s3:PutObject', 's3:PutObjectAcl'],
              resources: [`${eventBucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    });

    // IoT Rule Role (for Firehose action)
    const iotFirehoseRole = new iam.Role(this, 'IoTFirehoseRole', {
      assumedBy: new iam.ServicePrincipal('iot.amazonaws.com'),
    });

    // IoT Rule Error Action Role (for SQS)
    const iotErrorRole = new iam.Role(this, 'IoTErrorRole', {
      assumedBy: new iam.ServicePrincipal('iot.amazonaws.com'),
    });

    iotFirehoseErrorQueue.grantSendMessages(iotErrorRole);

    // ========================================
    // Kinesis Firehose
    // ========================================

    const firehoseStream = new firehose.CfnDeliveryStream(this, 'EventStream', {
      deliveryStreamName: `iot-events-stream-${environment}`,
      deliveryStreamType: 'DirectPut',
      extendedS3DestinationConfiguration: {
        bucketArn: eventBucket.bucketArn,
        prefix: 'events/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        errorOutputPrefix: 'errors/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
        compressionFormat: 'GZIP',
        bufferingHints: {
          sizeInMBs: 5,
          intervalInSeconds: 300,
        },
        roleArn: firehoseRole.roleArn,
      },
    });

    // Grant IoT Rule permission to write to Firehose
    iotFirehoseRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
        resources: [firehoseStream.attrArn],
      })
    );

    // ========================================
    // IoT Core Rule
    // ========================================

    const iotRule = new iot.CfnTopicRule(this, 'IoTEventsRule', {
      ruleName: `IoTEventsRule_${environment}`,
      topicRulePayload: {
        sql: "SELECT * FROM 'v1/gps/+/#'",
        actions: [
          {
            firehose: {
              deliveryStreamName: firehoseStream.ref,
              roleArn: iotFirehoseRole.roleArn,
              separator: '\n',
            },
          },
        ],
        errorAction: {
          sqs: {
            queueUrl: iotFirehoseErrorQueue.queueUrl,
            roleArn: iotErrorRole.roleArn,
            useBase64: false,
          },
        },
        awsIotSqlVersion: '2016-03-23',
        ruleDisabled: false,
      },
    });

    // ========================================
    // Lambda Function
    // ========================================

    // Determine Lambda code source
    const lambdaCode = lambdaCodeBucket && lambdaCodeKey
      ? lambda.Code.fromBucket(
          s3.Bucket.fromBucketName(this, `LambdaCodeBucket-${environment}`, lambdaCodeBucket),
          lambdaCodeKey
        )
      : lambda.Code.fromAsset('./dist'); // Fallback for local deployments

    const batchProcessor = new lambda.Function(this, 'BatchProcessor', {
      functionName: `iot-proximity-batch-processor-${environment}`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'src/index.handler',
      code: lambdaCode,
      memorySize: 3008, // 3 GB - sufficient for batch processing 23M events
      timeout: cdk.Duration.seconds(900), // 15 minutes
      architecture: lambda.Architecture.X86_64,
      environment: {
        EVENT_BUCKET_NAME: eventBucket.bucketName,
        REPORT_BUCKET_NAME: reportBucket.bucketName,
        VEHICLE_HANDHELD_TABLE_NAME: vehicleHandheldTableName,
        NOTIFICATION_TOPIC_ARN: notificationTopicArn,
        DISTANCE_THRESHOLD_METERS: '50',
        VEHICLE_STATIC_THRESHOLD_METERS: '10',
        VEHICLE_STATIC_THRESHOLD_SECONDS: '120',
        VEHICLE_STALENESS_THRESHOLD_SECONDS: '300',
        DEAD_LETTER_QUEUE_URL: deadLetterQueue.queueUrl,
        ENVIRONMENT: environment,
      },
      deadLetterQueue: deadLetterQueue,
      tracing: lambda.Tracing.ACTIVE, // Enable X-Ray
    });

    // Grant permissions
    eventBucket.grantRead(batchProcessor);
    eventBucket.grantWrite(batchProcessor); // For idempotency markers
    reportBucket.grantWrite(batchProcessor);
    deadLetterQueue.grantSendMessages(batchProcessor);

    // Grant DynamoDB scan permission on existing table
    batchProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Scan'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${vehicleHandheldTableName}`,
        ],
      })
    );

    // Grant SNS publish permission on existing topic
    batchProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [notificationTopicArn],
      })
    );

    // ========================================
    // CloudWatch Alarms
    // ========================================

    // Processing Duration Alarm
    const processingDurationAlarm = new cloudwatch.Alarm(this, 'ProcessingDurationAlarm', {
      alarmName: `iot-proximity-processing-duration-${environment}`,
      metric: batchProcessor.metricDuration({
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3000, // 3 seconds in milliseconds
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Event processing duration exceeded 3 seconds at P95',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alert Publication Failure Alarm
    const alertPublicationFailureAlarm = new cloudwatch.Alarm(this, 'AlertPublicationFailureAlarm', {
      alarmName: `iot-proximity-alert-publication-failure-${environment}`,
      metric: new cloudwatch.Metric({
        namespace: 'ProximityAlert',
        metricName: 'AlertPublicationFailure',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
        dimensionsMap: {
          Environment: environment,
        },
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Alert publication failures exceeded 5 per minute',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Dead Letter Queue Alarm
    const deadLetterQueueAlarm = new cloudwatch.Alarm(this, 'DeadLetterQueueAlarm', {
      alarmName: `iot-proximity-dlq-${environment}`,
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Messages detected in dead letter queue',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // IoT Error Queue Alarm
    const iotErrorQueueAlarm = new cloudwatch.Alarm(this, 'IoTErrorQueueAlarm', {
      alarmName: `iot-firehose-error-queue-${environment}`,
      metric: iotFirehoseErrorQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Failed IoT events detected - investigate immediately',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ========================================
    // EventBridge Schedule
    // ========================================

    const schedule = new events.Rule(this, 'DailySchedule', {
      ruleName: `iot-proximity-daily-schedule-${environment}`,
      schedule: events.Schedule.cron({ hour: '2', minute: '0' }), // 2 AM UTC daily
      targets: [
        new targets.LambdaFunction(batchProcessor, {
          event: events.RuleTargetInput.fromObject({
            processingDate: events.EventField.fromPath('$.time'),
          }),
        }),
      ],
    });

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'EventBucketName', {
      value: eventBucket.bucketName,
      description: 'S3 bucket for event storage',
      exportName: `iot-proximity-event-bucket-${environment}`,
    });

    new cdk.CfnOutput(this, 'ReportBucketName', {
      value: reportBucket.bucketName,
      description: 'S3 bucket for report storage',
      exportName: `iot-proximity-report-bucket-${environment}`,
    });

    new cdk.CfnOutput(this, 'BatchProcessorFunctionName', {
      value: batchProcessor.functionName,
      description: 'Lambda function for batch processing',
      exportName: `iot-proximity-batch-processor-${environment}`,
    });

    new cdk.CfnOutput(this, 'DeadLetterQueueUrl', {
      value: deadLetterQueue.queueUrl,
      description: 'SQS queue for failed batch jobs',
      exportName: `iot-proximity-dlq-url-${environment}`,
    });

    new cdk.CfnOutput(this, 'IoTFirehoseErrorQueueUrl', {
      value: iotFirehoseErrorQueue.queueUrl,
      description: 'SQS queue for failed IoT Core to Firehose deliveries',
      exportName: `iot-firehose-error-queue-url-${environment}`,
    });

    new cdk.CfnOutput(this, 'FirehoseStreamName', {
      value: firehoseStream.ref,
      description: 'Kinesis Firehose delivery stream',
      exportName: `iot-events-stream-${environment}`,
    });
  }
}
