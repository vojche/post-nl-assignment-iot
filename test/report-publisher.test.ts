/**
 * Unit tests for ReportPublisher
 * 
 * Tests SNS publishing, S3 storage, retry logic, and error handling.
 * 
 * **Validates: Requirements 6.2, 6.6, 6.7, 9.1, 9.2, 13.8**
 */

import { ReportPublisher } from '../src/publisher/ReportPublisher';
import { DailyReport, VehicleState } from '../src/models/types';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

// Create mocks
const snsMock = mockClient(SNSClient);
const s3Mock = mockClient(S3Client);

describe('ReportPublisher', () => {
  let publisher: ReportPublisher;
  let sampleReport: DailyReport;

  beforeEach(() => {
    // Reset mocks
    snsMock.reset();
    s3Mock.reset();

    // Create publisher instance
    publisher = new ReportPublisher({
      snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
      s3BucketName: 'test-bucket',
      maxRetries: 3,
      initialRetryDelayMs: 10, // Short delay for tests
    });

    // Sample report
    sampleReport = {
      reportDate: '2024-01-15',
      generatedAt: '2024-01-16T02:15:30Z',
      summary: {
        totalEvents: 23000000,
        totalVehicles: 2000,
        totalHandhelds: 2000,
        totalViolations: 1250,
        violationRate: 0.0054,
      },
      violations: [
        {
          timestamp: '2024-01-15T10:30:00Z',
          vehicleId: 'VV-AA-AA-AA-01',
          handheldId: 'HH-BB-BB-BB-01',
          handheldLatitude: 52.370216,
          handheldLongitude: 4.895168,
          vehicleLatitude: 52.370800,
          vehicleLongitude: 4.895200,
          distance: 75.3,
          vehicleState: VehicleState.PARKED,
        },
      ],
      metadata: {
        processingDuration: 850000,
        eventsProcessed: 23000000,
        eventsSkipped: 16100000,
        devicesWithNoData: {
          vehicles: [],
          handhelds: [],
        },
      },
    };
  });

  describe('publishToSNS', () => {
    it('should publish report to SNS topic', async () => {
      snsMock.on(PublishCommand).resolves({
        MessageId: 'test-message-id',
      });

      await publisher.publishToSNS(sampleReport);

      // Verify SNS publish was called
      const calls = snsMock.commandCalls(PublishCommand);
      expect(calls.length).toBe(1);
      expect(calls[0].args[0].input).toMatchObject({
        TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
        Subject: 'Daily Proximity Report - 2024-01-15',
      });

      // Verify message is valid JSON
      const message = calls[0].args[0].input.Message;
      expect(() => JSON.parse(message!)).not.toThrow();
      const parsedMessage = JSON.parse(message!);
      expect(parsedMessage.reportDate).toBe('2024-01-15');
    });

    it('should retry on SNS failure', async () => {
      // Fail twice, then succeed
      snsMock
        .on(PublishCommand)
        .rejectsOnce(new Error('Throttling'))
        .rejectsOnce(new Error('Throttling'))
        .resolves({ MessageId: 'test-message-id' });

      await publisher.publishToSNS(sampleReport);

      // Verify 3 attempts were made
      const calls = snsMock.commandCalls(PublishCommand);
      expect(calls.length).toBe(3);
    });

    it('should throw error after exhausting retries', async () => {
      // Fail all attempts
      snsMock.on(PublishCommand).rejects(new Error('Permanent failure'));

      await expect(publisher.publishToSNS(sampleReport)).rejects.toThrow(
        'SNS publish failed after 3 attempts'
      );

      // Verify all 3 attempts were made
      const calls = snsMock.commandCalls(PublishCommand);
      expect(calls.length).toBe(3);
    });

    it('should include all required fields in SNS message', async () => {
      snsMock.on(PublishCommand).resolves({ MessageId: 'test-message-id' });

      await publisher.publishToSNS(sampleReport);

      const calls = snsMock.commandCalls(PublishCommand);
      const message = JSON.parse(calls[0].args[0].input.Message!);

      expect(message).toHaveProperty('reportDate');
      expect(message).toHaveProperty('generatedAt');
      expect(message).toHaveProperty('summary');
      expect(message).toHaveProperty('violations');
      expect(message).toHaveProperty('metadata');
    });
  });

  describe('storeInS3', () => {
    it('should store report in S3 with date partitioning', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      await publisher.storeInS3(sampleReport);

      // Verify S3 put was called
      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls.length).toBe(1);
      expect(calls[0].args[0].input).toMatchObject({
        Bucket: 'test-bucket',
        Key: 'reports/year=2024/month=01/day=15/report.json',
        ContentType: 'application/json',
      });

      // Verify body is valid JSON
      const body = calls[0].args[0].input.Body;
      expect(() => JSON.parse(body as string)).not.toThrow();
    });

    it('should retry on S3 failure', async () => {
      // Fail twice, then succeed
      s3Mock
        .on(PutObjectCommand)
        .rejectsOnce(new Error('Throttling'))
        .rejectsOnce(new Error('Throttling'))
        .resolves({});

      await publisher.storeInS3(sampleReport);

      // Verify 3 attempts were made
      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls.length).toBe(3);
    });

    it('should throw error after exhausting retries', async () => {
      // Fail all attempts
      s3Mock.on(PutObjectCommand).rejects(new Error('Permanent failure'));

      await expect(publisher.storeInS3(sampleReport)).rejects.toThrow(
        'S3 storage failed after 3 attempts'
      );

      // Verify all 3 attempts were made
      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls.length).toBe(3);
    });

    it('should format S3 key correctly for different dates', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      const testCases = [
        { date: '2024-01-15', expected: 'reports/year=2024/month=01/day=15/report.json' },
        { date: '2024-12-31', expected: 'reports/year=2024/month=12/day=31/report.json' },
        { date: '2023-06-05', expected: 'reports/year=2023/month=06/day=05/report.json' },
      ];

      for (const testCase of testCases) {
        s3Mock.reset();
        const report = { ...sampleReport, reportDate: testCase.date };
        await publisher.storeInS3(report);

        const calls = s3Mock.commandCalls(PutObjectCommand);
        expect(calls[0].args[0].input.Key).toBe(testCase.expected);
      }
    });

    it('should store formatted JSON with indentation', async () => {
      s3Mock.on(PutObjectCommand).resolves({});

      await publisher.storeInS3(sampleReport);

      const calls = s3Mock.commandCalls(PutObjectCommand);
      const body = calls[0].args[0].input.Body as string;

      // Verify JSON is formatted (has newlines and indentation)
      expect(body).toContain('\n');
      expect(body).toContain('  '); // 2-space indentation
    });
  });

  describe('error logging', () => {
    it('should log errors on SNS failure', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      snsMock.on(PublishCommand).rejects(new Error('Test error'));

      await expect(publisher.publishToSNS(sampleReport)).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('SNS publish failed'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should log errors on S3 failure', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      s3Mock.on(PutObjectCommand).rejects(new Error('Test error'));

      await expect(publisher.storeInS3(sampleReport)).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('S3 storage failed'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('exponential backoff', () => {
    it('should use exponential backoff for retries', async () => {
      const startTime = Date.now();
      
      // Fail twice, then succeed
      snsMock
        .on(PublishCommand)
        .rejectsOnce(new Error('Throttling'))
        .rejectsOnce(new Error('Throttling'))
        .resolves({ MessageId: 'test-message-id' });

      await publisher.publishToSNS(sampleReport);

      const elapsedTime = Date.now() - startTime;

      // With initialRetryDelayMs=10:
      // First retry: 10ms * 2^0 = 10ms
      // Second retry: 10ms * 2^1 = 20ms
      // Total minimum: 30ms
      expect(elapsedTime).toBeGreaterThanOrEqual(30);
    });
  });
});
