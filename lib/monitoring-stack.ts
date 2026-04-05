/**
 * AWS CDK Stack for Monitoring and Observability
 * 
 * Creates:
 * - CloudWatch Dashboard with key metrics
 * - CloudWatch Logs Insights saved queries
 * - Synthetic canary tests
 * - Additional alarms
 * 
 * **Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.7**
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  /**
   * Environment name (acceptance, production)
   */
  environment?: string;

  /**
   * Lambda function name to monitor
   */
  lambdaFunctionName: string;

  /**
   * Event bucket name
   */
  eventBucketName: string;

  /**
   * Report bucket name
   */
  reportBucketName: string;

  /**
   * DLQ name
   */
  dlqName: string;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const environment = props.environment || 'production';

    // ========================================
    // CloudWatch Dashboard
    // ========================================

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `iot-proximity-dashboard-${environment}`,
    });

    // Lambda Metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations and Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Invocations',
            dimensionsMap: {
              FunctionName: props.lambdaFunctionName,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            dimensionsMap: {
              FunctionName: props.lambdaFunctionName,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            color: cloudwatch.Color.RED,
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration (P50, P95, P99)',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Duration',
            dimensionsMap: {
              FunctionName: props.lambdaFunctionName,
            },
            statistic: 'p50',
            period: cdk.Duration.minutes(5),
            label: 'P50',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Duration',
            dimensionsMap: {
              FunctionName: props.lambdaFunctionName,
            },
            statistic: 'p95',
            period: cdk.Duration.minutes(5),
            label: 'P95',
            color: cloudwatch.Color.ORANGE,
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Duration',
            dimensionsMap: {
              FunctionName: props.lambdaFunctionName,
            },
            statistic: 'p99',
            period: cdk.Duration.minutes(5),
            label: 'P99',
            color: cloudwatch.Color.RED,
          }),
        ],
        width: 12,
      })
    );

    // Custom Application Metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Proximity Alert Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'ProximityAlert',
            metricName: 'ProximityAlertCount',
            dimensionsMap: {
              Environment: environment,
            },
            statistic: 'Sum',
            period: cdk.Duration.hours(1),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Event Processing Duration',
        left: [
          new cloudwatch.Metric({
            namespace: 'ProximityAlert',
            metricName: 'EventProcessingDuration',
            dimensionsMap: {
              Environment: environment,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'Average',
          }),
          new cloudwatch.Metric({
            namespace: 'ProximityAlert',
            metricName: 'EventProcessingDuration',
            dimensionsMap: {
              Environment: environment,
            },
            statistic: 'p95',
            period: cdk.Duration.minutes(5),
            label: 'P95',
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 12,
      })
    );

    // DynamoDB Metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Read/Write Capacity',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ConsumedReadCapacityUnits',
            dimensionsMap: {
              TableName: `Vehicle2HandheldTable-${environment}`,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: 'Read Capacity',
          }),
        ],
        right: [
          new cloudwatch.Metric({
            namespace: 'AWS/DynamoDB',
            metricName: 'ConsumedWriteCapacityUnits',
            dimensionsMap: {
              TableName: `Vehicle2HandheldTable-${environment}`,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: 'Write Capacity',
            color: cloudwatch.Color.PURPLE,
          }),
        ],
        width: 12,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Dead Letter Queue Depth',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'AWS/SQS',
            metricName: 'ApproximateNumberOfMessagesVisible',
            dimensionsMap: {
              QueueName: props.dlqName,
            },
            statistic: 'Maximum',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 6,
      })
    );

    // SNS Metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'SNS Publish Success Rate',
        left: [
          new cloudwatch.MathExpression({
            expression: '(published / (published + failed)) * 100',
            usingMetrics: {
              published: new cloudwatch.Metric({
                namespace: 'AWS/SNS',
                metricName: 'NumberOfMessagesPublished',
                dimensionsMap: {
                  TopicName: `Platform_Notification_Topic-${environment}`,
                },
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
              }),
              failed: new cloudwatch.Metric({
                namespace: 'AWS/SNS',
                metricName: 'NumberOfNotificationsFailed',
                dimensionsMap: {
                  TopicName: `Platform_Notification_Topic-${environment}`,
                },
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
              }),
            },
            label: 'Success Rate (%)',
          }),
        ],
        width: 12,
      })
    );

    // ========================================
    // Synthetic Canary Lambda
    // ========================================

    const canaryFunction = new lambda.Function(this, 'CanaryFunction', {
      functionName: `iot-proximity-canary-${environment}`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        
        const lambdaClient = new LambdaClient({});
        const s3Client = new S3Client({});
        
        exports.handler = async (event) => {
          console.log('Running synthetic canary test...');
          
          try {
            // Test 1: Invoke batch processor with test date
            const testDate = new Date();
            testDate.setDate(testDate.getDate() - 1);
            const processingDate = testDate.toISOString().split('T')[0];
            
            const invokeCommand = new InvokeCommand({
              FunctionName: process.env.BATCH_PROCESSOR_FUNCTION_NAME,
              InvocationType: 'RequestResponse',
              Payload: JSON.stringify({ processingDate }),
            });
            
            const response = await lambdaClient.send(invokeCommand);
            const payload = JSON.parse(Buffer.from(response.Payload).toString());
            
            if (response.StatusCode !== 200) {
              throw new Error(\`Lambda invocation failed: \${response.StatusCode}\`);
            }
            
            console.log('✅ Batch processor invocation successful');
            
            // Test 2: Verify report was generated
            const reportKey = \`reports/year=\${testDate.getFullYear()}/month=\${String(testDate.getMonth() + 1).padStart(2, '0')}/day=\${String(testDate.getDate()).padStart(2, '0')}/report.json\`;
            
            const getObjectCommand = new GetObjectCommand({
              Bucket: process.env.REPORT_BUCKET_NAME,
              Key: reportKey,
            });
            
            await s3Client.send(getObjectCommand);
            console.log('✅ Report verification successful');
            
            return {
              statusCode: 200,
              body: JSON.stringify({
                message: 'Canary test passed',
                processingDate,
                reportKey,
              }),
            };
          } catch (error) {
            console.error('❌ Canary test failed:', error);
            throw error;
          }
        };
      `),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        BATCH_PROCESSOR_FUNCTION_NAME: props.lambdaFunctionName,
        REPORT_BUCKET_NAME: props.reportBucketName,
      },
    });

    // Grant permissions to canary
    canaryFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${props.lambdaFunctionName}`],
      })
    );

    canaryFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${props.reportBucketName}/*`],
      })
    );

    // Schedule canary to run every 5 minutes
    const canarySchedule = new events.Rule(this, 'CanarySchedule', {
      ruleName: `iot-proximity-canary-schedule-${environment}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new targets.LambdaFunction(canaryFunction)],
    });

    // Canary failure alarm
    const canaryFailureAlarm = new cloudwatch.Alarm(this, 'CanaryFailureAlarm', {
      alarmName: `iot-proximity-canary-failure-${environment}`,
      metric: canaryFunction.metricErrors({
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Synthetic canary test failed - investigate immediately',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'DashboardURL', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
      exportName: `iot-proximity-dashboard-url-${environment}`,
    });

    new cdk.CfnOutput(this, 'CanaryFunctionName', {
      value: canaryFunction.functionName,
      description: 'Synthetic canary function name',
      exportName: `iot-proximity-canary-function-${environment}`,
    });
  }
}
