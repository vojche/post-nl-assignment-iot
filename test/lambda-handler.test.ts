/**
 * Integration tests for Lambda handler
 * 
 * Tests end-to-end processing with sample events, error handling, DLQ, 
 * CloudWatch metrics, and idempotency.
 * 
 * **Validates: Requirements 13.3, 13.6, 13.7, 13.8, 15.1, 15.2, 15.3, 15.4, 15.5**
 */

import { handler } from '../src/index';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { mockClient } from 'aws-sdk-client-mock';

// Create mocks
const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBClient);
const snsMock = mockClient(SNSClient);
const sqsMock = mockClient(SQSClient);
const cloudWatchMock = mockClient(CloudWatchClient);

describe('Lambda Handler Integration Tests', () => {
  beforeEach(() => {
    // Reset all mocks
    s3Mock.reset();
    dynamoMock.reset();
    snsMock.reset();
    sqsMock.reset();
    cloudWatchMock.reset();

    // Set environment variables
    process.env.EVENT_BUCKET_NAME = 'test-events-bucket';
    process.env.REPORT_BUCKET_NAME = 'test-reports-bucket';
    process.env.VEHICLE_HANDHELD_TABLE_NAME = 'Vehicle2HandheldTable';
    process.env.NOTIFICATION_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';
    process.env.DEAD_LETTER_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-dlq';
    process.env.DISTANCE_THRESHOLD_METERS = '50';
    process.env.VEHICLE_STATIC_THRESHOLD_METERS = '10';
    process.env.VEHICLE_STATIC_THRESHOLD_SECONDS = '120';
    process.env.VEHICLE_STALENESS_THRESHOLD_SECONDS = '300';
    process.env.ENVIRONMENT = 'test';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Error handling', () => {
    it('should send failed job to DLQ on error', async () => {
      // Mock idempotency check
      s3Mock.on(HeadObjectCommand).rejects({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });

      // Mock DynamoDB scan to fail
      dynamoMock.on(ScanCommand).rejects(new Error('DynamoDB error'));

      // Mock SQS send
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'dlq-message-id' });

      // Mock CloudWatch metrics
      cloudWatchMock.on(PutMetricDataCommand).resolves({});

      const event = {
        processingDate: '2024-01-15',
      };

      await expect(handler(event)).rejects.toThrow('DynamoDB error');

      // Verify DLQ was called
      expect(sqsMock.calls()).toHaveLength(1);
      const dlqCall = sqsMock.call(0);
      expect(dlqCall.args[0].input).toMatchObject({
        QueueUrl: process.env.DEAD_LETTER_QUEUE_URL,
      });
    });

    it('should emit failure metric on error', async () => {
      // Mock idempotency check
      s3Mock.on(HeadObjectCommand).rejects({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });

      // Mock DynamoDB scan to fail
      dynamoMock.on(ScanCommand).rejects(new Error('DynamoDB error'));

      // Mock SQS send
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'dlq-message-id' });

      // Mock CloudWatch metrics
      cloudWatchMock.on(PutMetricDataCommand).resolves({});

      const event = {
        processingDate: '2024-01-15',
      };

      await expect(handler(event)).rejects.toThrow();

      // Verify failure metric was emitted
      const metricCalls = cloudWatchMock.calls();
      const failureMetric = metricCalls.find(call => {
        const input = call.args[0].input as any;
        return input.MetricData?.some((m: any) => m.MetricName === 'BatchProcessingFailure');
      });

      expect(failureMetric).toBeDefined();
    });
  });

  describe('Idempotency', () => {
    it('should skip processing if job already completed', async () => {
      // Mock idempotency check (already processed)
      s3Mock.on(HeadObjectCommand).resolves({});

      const event = {
        processingDate: '2024-01-15',
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        message: 'Job already processed',
        processingDate: '2024-01-15',
      });

      // Verify no DynamoDB scan was performed
      expect(dynamoMock.calls()).toHaveLength(0);
    });
  });

  describe('Input validation', () => {
    it('should parse YYYY-MM-DD date format', async () => {
      // Mock idempotency check (already processed to avoid full execution)
      s3Mock.on(HeadObjectCommand).resolves({});

      const event = {
        processingDate: '2024-01-15',
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).processingDate).toBe('2024-01-15');
    });

    it('should parse ISO 8601 timestamp and get previous day', async () => {
      // Mock idempotency check (already processed to avoid full execution)
      s3Mock.on(HeadObjectCommand).resolves({});

      const event = {
        processingDate: '2024-01-16T02:00:00Z', // 2 AM on Jan 16
      };

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      // Should process Jan 15 (previous day)
      expect(JSON.parse(response.body).processingDate).toBe('2024-01-15');
    });

    it('should throw error for invalid date format', async () => {
      const event = {
        processingDate: 'invalid-date',
      };

      await expect(handler(event)).rejects.toThrow('Invalid processingDate');
    });
  });
});
