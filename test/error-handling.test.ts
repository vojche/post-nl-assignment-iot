/**
 * Unit tests for error handling and retry logic
 * 
 * Tests retry logic with transient failures, DLQ message sending,
 * and error logging for various failure scenarios.
 * 
 * **Validates: Requirements 10.6, 10.7, 15.1, 15.2, 15.3**
 */

import { MappingLoader } from '../src/loader/MappingLoader';
import { ReportPublisher } from '../src/publisher/ReportPublisher';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

const dynamoMock = mockClient(DynamoDBClient);
const snsMock = mockClient(SNSClient);
const s3Mock = mockClient(S3Client);

describe('Error Handling Tests', () => {
  beforeEach(() => {
    dynamoMock.reset();
    snsMock.reset();
    s3Mock.reset();
    jest.clearAllMocks();
  });

  describe('MappingLoader retry logic', () => {
    it('should retry on DynamoDB throttling and succeed on second attempt', async () => {
      const dynamoClient = new DynamoDBClient({});
      const mappingLoader = new MappingLoader(dynamoClient, 'TestTable');

      // First call fails, second succeeds
      dynamoMock
        .on(ScanCommand)
        .rejectsOnce(new Error('ProvisionedThroughputExceededException'))
        .resolvesOnce({
          Items: [
            {
              vehicleId: { S: 'VV-AA-AA-AA-01' },
              handheldId: { S: 'HH-BB-BB-BB-01' },
            },
          ],
        });

      const result = await mappingLoader.loadAllMappings();

      expect(result.size).toBe(1);
      expect(result.get('VV-AA-AA-AA-01')).toBe('HH-BB-BB-BB-01');
      expect(dynamoMock.calls()).toHaveLength(2);
    });

    it('should retry with exponential backoff', async () => {
      const dynamoClient = new DynamoDBClient({});
      const mappingLoader = new MappingLoader(dynamoClient, 'TestTable');

      // All calls fail
      dynamoMock
        .on(ScanCommand)
        .rejects(new Error('ProvisionedThroughputExceededException'));

      const startTime = Date.now();
      
      await expect(mappingLoader.loadAllMappings()).rejects.toThrow(
        'Failed to load mappings from DynamoDB'
      );

      const duration = Date.now() - startTime;

      // Should have retried 3 times with backoff: 100ms + 200ms = 300ms minimum
      // (Note: The third attempt doesn't have a backoff since it's the last one)
      expect(duration).toBeGreaterThanOrEqual(300);
      expect(dynamoMock.calls()).toHaveLength(3);
    });

    it('should throw error after exhausting all retries', async () => {
      const dynamoClient = new DynamoDBClient({});
      const mappingLoader = new MappingLoader(dynamoClient, 'TestTable');

      dynamoMock
        .on(ScanCommand)
        .rejects(new Error('ProvisionedThroughputExceededException'));

      await expect(mappingLoader.loadAllMappings()).rejects.toThrow(
        'Failed to load mappings from DynamoDB: ProvisionedThroughputExceededException'
      );

      expect(dynamoMock.calls()).toHaveLength(3);
    });

    it('should handle pagination correctly after retry', async () => {
      const dynamoClient = new DynamoDBClient({});
      const mappingLoader = new MappingLoader(dynamoClient, 'TestTable');

      // First page succeeds, second page fails once then succeeds
      dynamoMock
        .on(ScanCommand)
        .resolvesOnce({
          Items: [
            {
              vehicleId: { S: 'VV-AA-AA-AA-01' },
              handheldId: { S: 'HH-BB-BB-BB-01' },
            },
          ],
          LastEvaluatedKey: {
            vehicleId: { S: 'VV-AA-AA-AA-01' },
          },
        })
        .rejectsOnce(new Error('ProvisionedThroughputExceededException'))
        .resolvesOnce({
          Items: [
            {
              vehicleId: { S: 'VV-AA-AA-AA-02' },
              handheldId: { S: 'HH-BB-BB-BB-02' },
            },
          ],
        });

      const result = await mappingLoader.loadAllMappings();

      expect(result.size).toBe(2);
      expect(result.get('VV-AA-AA-AA-01')).toBe('HH-BB-BB-BB-01');
      expect(result.get('VV-AA-AA-AA-02')).toBe('HH-BB-BB-BB-02');
      expect(dynamoMock.calls()).toHaveLength(3);
    });
  });

  describe('ReportPublisher retry logic', () => {
    it('should retry SNS publish on throttling and succeed', async () => {
      const publisher = new ReportPublisher({
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
        s3BucketName: 'test-bucket',
      });

      const report = {
        reportDate: '2024-01-15',
        generatedAt: '2024-01-16T02:00:00Z',
        summary: {
          totalEvents: 100,
          totalVehicles: 10,
          totalHandhelds: 10,
          totalViolations: 5,
          violationRate: 5.0,
        },
        violations: [],
        metadata: {
          processingDuration: 1000,
          eventsProcessed: 100,
          eventsSkipped: 0,
          devicesWithNoData: {
            vehicles: [],
            handhelds: [],
          },
        },
      };

      // First call fails, second succeeds
      snsMock
        .on(PublishCommand)
        .rejectsOnce(new Error('Throttling'))
        .resolvesOnce({ MessageId: 'test-message-id' });

      await publisher.publishToSNS(report);

      expect(snsMock.calls()).toHaveLength(2);
    });

    it('should retry S3 storage on error and succeed', async () => {
      const publisher = new ReportPublisher({
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
        s3BucketName: 'test-bucket',
      });

      const report = {
        reportDate: '2024-01-15',
        generatedAt: '2024-01-16T02:00:00Z',
        summary: {
          totalEvents: 100,
          totalVehicles: 10,
          totalHandhelds: 10,
          totalViolations: 5,
          violationRate: 5.0,
        },
        violations: [],
        metadata: {
          processingDuration: 1000,
          eventsProcessed: 100,
          eventsSkipped: 0,
          devicesWithNoData: {
            vehicles: [],
            handhelds: [],
          },
        },
      };

      // First call fails, second succeeds
      s3Mock
        .on(PutObjectCommand)
        .rejectsOnce(new Error('SlowDown'))
        .resolvesOnce({});

      await publisher.storeInS3(report);

      expect(s3Mock.calls()).toHaveLength(2);
    });

    it('should throw error after exhausting SNS retries', async () => {
      const publisher = new ReportPublisher({
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
        s3BucketName: 'test-bucket',
      });

      const report = {
        reportDate: '2024-01-15',
        generatedAt: '2024-01-16T02:00:00Z',
        summary: {
          totalEvents: 100,
          totalVehicles: 10,
          totalHandhelds: 10,
          totalViolations: 5,
          violationRate: 5.0,
        },
        violations: [],
        metadata: {
          processingDuration: 1000,
          eventsProcessed: 100,
          eventsSkipped: 0,
          devicesWithNoData: {
            vehicles: [],
            handhelds: [],
          },
        },
      };

      snsMock.on(PublishCommand).rejects(new Error('Throttling'));

      await expect(publisher.publishToSNS(report)).rejects.toThrow(
        'SNS publish failed after 3 attempts'
      );

      expect(snsMock.calls()).toHaveLength(3);
    });

    it('should throw error after exhausting S3 retries', async () => {
      const publisher = new ReportPublisher({
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
        s3BucketName: 'test-bucket',
      });

      const report = {
        reportDate: '2024-01-15',
        generatedAt: '2024-01-16T02:00:00Z',
        summary: {
          totalEvents: 100,
          totalVehicles: 10,
          totalHandhelds: 10,
          totalViolations: 5,
          violationRate: 5.0,
        },
        violations: [],
        metadata: {
          processingDuration: 1000,
          eventsProcessed: 100,
          eventsSkipped: 0,
          devicesWithNoData: {
            vehicles: [],
            handhelds: [],
          },
        },
      };

      s3Mock.on(PutObjectCommand).rejects(new Error('SlowDown'));

      await expect(publisher.storeInS3(report)).rejects.toThrow(
        'S3 storage failed after 3 attempts'
      );

      expect(s3Mock.calls()).toHaveLength(3);
    });
  });

  describe('Error logging', () => {
    it('should log errors with context information', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const dynamoClient = new DynamoDBClient({});
      const mappingLoader = new MappingLoader(dynamoClient, 'TestTable');

      dynamoMock.on(ScanCommand).rejects(new Error('Test error'));

      await expect(mappingLoader.loadAllMappings()).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MappingLoader] Failed to scan DynamoDB after 3 attempts'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should log retry attempts with backoff time', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const dynamoClient = new DynamoDBClient({});
      const mappingLoader = new MappingLoader(dynamoClient, 'TestTable');

      dynamoMock.on(ScanCommand).rejects(new Error('Test error'));

      await expect(mappingLoader.loadAllMappings()).rejects.toThrow();

      // Should log retry attempts
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MappingLoader] Scan failed (attempt 1/3), retrying in 100ms'),
        expect.any(String)
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MappingLoader] Scan failed (attempt 2/3), retrying in 200ms'),
        expect.any(String)
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
