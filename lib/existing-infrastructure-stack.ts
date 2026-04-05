/**
 * Existing Infrastructure Stack
 * 
 * This stack creates the "existing" infrastructure that the IoT Proximity Alert System
 * depends on:
 * - Vehicle2HandheldTable (DynamoDB)
 * - Platform_Notification_Topic (SNS)
 * 
 * Deploy this FIRST before deploying the main IoT Proximity Alert Stack.
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface ExistingInfrastructureStackProps extends cdk.StackProps {
  /**
   * Environment name (acceptance, production, test)
   */
  environment?: string;

  /**
   * Optional email address to receive SNS notifications
   */
  notificationEmail?: string;
}

export class ExistingInfrastructureStack extends cdk.Stack {
  public readonly vehicleHandheldTable: dynamodb.Table;
  public readonly notificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: ExistingInfrastructureStackProps) {
    super(scope, id, props);

    const environment = props?.environment || 'production';

    // ========================================
    // DynamoDB Table: Vehicle2HandheldTable
    // ========================================
    
    this.vehicleHandheldTable = new dynamodb.Table(this, 'Vehicle2HandheldTable', {
      tableName: `Vehicle2HandheldTable-${environment}`,
      partitionKey: {
        name: 'vehicleId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand pricing
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true, // Enable backups
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep table if stack is deleted
    });

    // Add Global Secondary Index for querying by handheldId
    this.vehicleHandheldTable.addGlobalSecondaryIndex({
      indexName: 'HandheldIdIndex',
      partitionKey: {
        name: 'handheldId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL, // Include all attributes
    });

    // Add tags for cost tracking
    cdk.Tags.of(this.vehicleHandheldTable).add('Environment', environment);
    cdk.Tags.of(this.vehicleHandheldTable).add('Application', 'IoT-Proximity-Alert');
    cdk.Tags.of(this.vehicleHandheldTable).add('Component', 'Vehicle-Handheld-Mapping');

    // ========================================
    // SNS Topic: Platform_Notification_Topic
    // ========================================
    
    this.notificationTopic = new sns.Topic(this, 'PlatformNotificationTopic', {
      topicName: `Platform_Notification_Topic-${environment}`,
      displayName: 'IoT Platform Notifications',
      fifo: false,
    });

    // Add email subscription if provided
    if (props?.notificationEmail) {
      this.notificationTopic.addSubscription(
        new subscriptions.EmailSubscription(props.notificationEmail)
      );
    }

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'VehicleHandheldTableName', {
      value: this.vehicleHandheldTable.tableName,
      description: 'DynamoDB table name for vehicle-handheld mappings',
      exportName: `vehicle-handheld-table-name-${environment}`,
    });

    new cdk.CfnOutput(this, 'VehicleHandheldTableArn', {
      value: this.vehicleHandheldTable.tableArn,
      description: 'DynamoDB table ARN',
      exportName: `vehicle-handheld-table-arn-${environment}`,
    });

    new cdk.CfnOutput(this, 'NotificationTopicArn', {
      value: this.notificationTopic.topicArn,
      description: 'SNS topic ARN for platform notifications',
      exportName: `notification-topic-arn-${environment}`,
    });

    new cdk.CfnOutput(this, 'NotificationTopicName', {
      value: this.notificationTopic.topicName,
      description: 'SNS topic name',
      exportName: `notification-topic-name-${environment}`,
    });
  }
}
