/**
 * Unit Tests for MappingLoader
 * 
 * Tests loading mappings from DynamoDB, pagination handling,
 * retry logic, and read-only access.
 * 
 * **Validates: Requirements 13.7, 3.5, 10.6**
 */

import { MappingLoader } from '../src/loader/MappingLoader';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { marshall } from '@aws-sdk/util-dynamodb';

describe('MappingLoader', () => {
  const dynamoMock = mockClient(DynamoDBClient);
  const tableName = 'Vehicle2HandheldTable';

  beforeEach(() => {
    dynamoMock.reset();
  });

  describe('loadAllMappings', () => {
    it('should load mappings from DynamoDB', async () => {
      // Setup: Mock DynamoDB scan response
      const mockMappings = [
        { vehicleId: 'VV-AA-AA-AA-01', handheldId: 'HH-BB-BB-BB-01' },
        { vehicleId: 'VV-AA-AA-AA-02', handheldId: 'HH-BB-BB-BB-02' },
        { vehicleId: 'VV-AA-AA-AA-03', handheldId: 'HH-BB-BB-BB-03' },
      ];

      dynamoMock.on(ScanCommand).resolves({
        Items: mockMappings.map(m => marshall(m)),
        Count: mockMappings.length,
      });

      // Execute
      const loader = new MappingLoader(new DynamoDBClient({}), tableName);
      const mappings = await loader.loadAllMappings();

      // Verify
      expect(mappings.size).toBe(3);
      expect(mappings.get('VV-AA-AA-AA-01')).toBe('HH-BB-BB-BB-01');
      expect(mappings.get('VV-AA-AA-AA-02')).toBe('HH-BB-BB-BB-02');
      expect(mappings.get('VV-AA-AA-AA-03')).toBe('HH-BB-BB-BB-03');
    });

    it('should handle pagination with multiple scan responses', async () => {
      // Setup: Mock paginated DynamoDB scan responses
      const page1 = [
        { vehicleId: 'VV-AA-AA-AA-01', handheldId: 'HH-BB-BB-BB-01' },
        { vehicleId: 'VV-AA-AA-AA-02', handheldId: 'HH-BB-BB-BB-02' },
      ];

      const page2 = [
        { vehicleId: 'VV-AA-AA-AA-03', handheldId: 'HH-BB-BB-BB-03' },
        { vehicleId: 'VV-AA-AA-AA-04', handheldId: 'HH-BB-BB-BB-04' },
      ];

      dynamoMock
        .on(ScanCommand)
        .resolvesOnce({
          Items: page1.map(m => marshall(m)),
          Count: page1.length,
          LastEvaluatedKey: marshall({ vehicleId: 'VV-AA-AA-AA-02' }),
        })
        .resolvesOnce({
          Items: page2.map(m => marshall(m)),
          Count: page2.length,
        });

      // Execute
      const loader = new MappingLoader(new DynamoDBClient({}), tableName);
      const mappings = await loader.loadAllMappings();

      // Verify: All mappings from both pages are loaded
      expect(mappings.size).toBe(4);
      expect(mappings.get('VV-AA-AA-AA-01')).toBe('HH-BB-BB-BB-01');
      expect(mappings.get('VV-AA-AA-AA-02')).toBe('HH-BB-BB-BB-02');
      expect(mappings.get('VV-AA-AA-AA-03')).toBe('HH-BB-BB-BB-03');
      expect(mappings.get('VV-AA-AA-AA-04')).toBe('HH-BB-BB-BB-04');

      // Verify: Scan was called twice
      expect(dynamoMock.calls().length).toBe(2);
    });

    it('should retry on DynamoDB throttling', async () => {
      // Setup: Mock throttling error followed by success
      const mockMappings = [
        { vehicleId: 'VV-AA-AA-AA-01', handheldId: 'HH-BB-BB-BB-01' },
      ];

      dynamoMock
        .on(ScanCommand)
        .rejectsOnce(new Error('ProvisionedThroughputExceededException'))
        .resolvesOnce({
          Items: mockMappings.map(m => marshall(m)),
          Count: mockMappings.length,
        });

      // Execute
      const loader = new MappingLoader(new DynamoDBClient({}), tableName);
      const mappings = await loader.loadAllMappings();

      // Verify: Mappings loaded successfully after retry
      expect(mappings.size).toBe(1);
      expect(mappings.get('VV-AA-AA-AA-01')).toBe('HH-BB-BB-BB-01');

      // Verify: Scan was called twice (1 failure + 1 success)
      expect(dynamoMock.calls().length).toBe(2);
    });

    it('should fail after exhausting retry attempts', async () => {
      // Setup: Mock persistent throttling errors
      dynamoMock
        .on(ScanCommand)
        .rejects(new Error('ProvisionedThroughputExceededException'));

      // Execute & Verify: Should throw after 3 attempts
      const loader = new MappingLoader(new DynamoDBClient({}), tableName);
      
      await expect(loader.loadAllMappings()).rejects.toThrow(
        'Failed to load mappings from DynamoDB'
      );

      // Verify: Scan was called 3 times (max retries)
      expect(dynamoMock.calls().length).toBe(3);
    });

    it('should handle empty DynamoDB table', async () => {
      // Setup: Mock empty scan response
      dynamoMock.on(ScanCommand).resolves({
        Items: [],
        Count: 0,
      });

      // Execute
      const loader = new MappingLoader(new DynamoDBClient({}), tableName);
      const mappings = await loader.loadAllMappings();

      // Verify: Empty Map returned
      expect(mappings.size).toBe(0);
    });

    it('should skip items with missing fields', async () => {
      // Setup: Mock scan response with some invalid items
      const mockItems = [
        { vehicleId: 'VV-AA-AA-AA-01', handheldId: 'HH-BB-BB-BB-01' }, // Valid
        { vehicleId: 'VV-AA-AA-AA-02' }, // Missing handheldId
        { handheldId: 'HH-BB-BB-BB-03' }, // Missing vehicleId
        { vehicleId: 'VV-AA-AA-AA-04', handheldId: 'HH-BB-BB-BB-04' }, // Valid
      ];

      dynamoMock.on(ScanCommand).resolves({
        Items: mockItems.map(m => marshall(m)),
        Count: mockItems.length,
      });

      // Execute
      const loader = new MappingLoader(new DynamoDBClient({}), tableName);
      const mappings = await loader.loadAllMappings();

      // Verify: Only valid items are loaded
      expect(mappings.size).toBe(2);
      expect(mappings.get('VV-AA-AA-AA-01')).toBe('HH-BB-BB-BB-01');
      expect(mappings.get('VV-AA-AA-AA-04')).toBe('HH-BB-BB-BB-04');
      expect(mappings.get('VV-AA-AA-AA-02')).toBeUndefined();
    });

    it('should only perform read operations (no writes to table)', async () => {
      // Setup: Mock DynamoDB scan response
      const mockMappings = [
        { vehicleId: 'VV-AA-AA-AA-01', handheldId: 'HH-BB-BB-BB-01' },
      ];

      dynamoMock.on(ScanCommand).resolves({
        Items: mockMappings.map(m => marshall(m)),
        Count: mockMappings.length,
      });

      // Execute
      const loader = new MappingLoader(new DynamoDBClient({}), tableName);
      await loader.loadAllMappings();

      // Verify: Only ScanCommand was called (no PutItem, UpdateItem, DeleteItem)
      const calls = dynamoMock.calls();
      expect(calls.length).toBe(1);
      expect(calls[0].args[0].input).toHaveProperty('TableName', tableName);
      
      // Verify: No write operations
      const writeCommands = calls.filter(call => {
        const commandName = call.args[0].constructor.name;
        return commandName.includes('Put') || 
               commandName.includes('Update') || 
               commandName.includes('Delete');
      });
      expect(writeCommands.length).toBe(0);
    });
  });
});
