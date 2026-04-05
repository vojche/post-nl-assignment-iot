/**
 * Property-Based Tests for Mapping Lookup
 * 
 * **Property 3: Mapping Lookup Correctness**
 * **Validates: Requirements 3.1, 3.2, 3.3**
 */

import * as fc from 'fast-check';
import { MappingLoader } from '../src/loader/MappingLoader';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { marshall } from '@aws-sdk/util-dynamodb';

describe('Property Test: Mapping Lookup Correctness', () => {
  const dynamoMock = mockClient(DynamoDBClient);

  beforeEach(() => {
    dynamoMock.reset();
  });

  /**
   * Property 3: Mapping Lookup Correctness
   * 
   * For any set of vehicle-handheld mappings loaded from DynamoDB,
   * the in-memory Map should return the correct handheldId for each vehicleId,
   * or null for vehicleIds that don't exist in the mappings.
   */
  it('should return correct handheldId for mapped vehicles and null for unmapped vehicles', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random vehicle-handheld mappings
        fc.array(
          fc.record({
            vehicleId: fc.string({ minLength: 1, maxLength: 20 }),
            handheldId: fc.string({ minLength: 1, maxLength: 20 }),
          }),
          { minLength: 0, maxLength: 100 }
        ),
        // Generate random vehicleIds to query (some exist, some don't)
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }),
          { minLength: 0, maxLength: 20 }
        ),
        async (mappings, queryVehicleIds) => {
          // Setup: Mock DynamoDB scan response
          const items = mappings.map(mapping => marshall(mapping));
          
          dynamoMock.on(ScanCommand).resolves({
            Items: items,
            Count: items.length,
          });

          // Load mappings
          const loader = new MappingLoader(new DynamoDBClient({}), 'TestTable');
          const loadedMappings = await loader.loadAllMappings();

          // Build expected mappings (last occurrence wins for duplicate vehicleIds)
          const expectedMappings = new Map<string, string>();
          for (const mapping of mappings) {
            expectedMappings.set(mapping.vehicleId, mapping.handheldId);
          }

          // Verify: All mappings are loaded correctly
          for (const [vehicleId, expectedHandheldId] of expectedMappings) {
            const result = loadedMappings.get(vehicleId);
            if (result !== expectedHandheldId) {
              return false;
            }
          }

          // Verify: Querying non-existent vehicleIds returns undefined
          for (const vehicleId of queryVehicleIds) {
            const result = loadedMappings.get(vehicleId);
            const expectedMapping = expectedMappings.get(vehicleId);
            
            if (expectedMapping) {
              // Should return the handheldId
              if (result !== expectedMapping) {
                return false;
              }
            } else {
              // Should return undefined
              if (result !== undefined) {
                return false;
              }
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Mapping lookup is deterministic
   * 
   * Loading the same mappings multiple times should produce identical results.
   */
  it('should produce identical results when loading same mappings multiple times', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            vehicleId: fc.string({ minLength: 1, maxLength: 20 }),
            handheldId: fc.string({ minLength: 1, maxLength: 20 }),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        async (mappings) => {
          // Setup: Mock DynamoDB scan response
          const items = mappings.map(mapping => marshall(mapping));
          
          dynamoMock.on(ScanCommand).resolves({
            Items: items,
            Count: items.length,
          });

          // Load mappings twice
          const loader = new MappingLoader(new DynamoDBClient({}), 'TestTable');
          const loadedMappings1 = await loader.loadAllMappings();
          
          dynamoMock.reset();
          dynamoMock.on(ScanCommand).resolves({
            Items: items,
            Count: items.length,
          });
          
          const loadedMappings2 = await loader.loadAllMappings();

          // Verify: Both loads produce identical results
          if (loadedMappings1.size !== loadedMappings2.size) {
            return false;
          }

          for (const [vehicleId, handheldId] of loadedMappings1) {
            if (loadedMappings2.get(vehicleId) !== handheldId) {
              return false;
            }
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Empty mappings table returns empty Map
   */
  it('should return empty Map when DynamoDB table is empty', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // No input needed
        async () => {
          // Setup: Mock empty DynamoDB scan response
          dynamoMock.on(ScanCommand).resolves({
            Items: [],
            Count: 0,
          });

          // Load mappings
          const loader = new MappingLoader(new DynamoDBClient({}), 'TestTable');
          const loadedMappings = await loader.loadAllMappings();

          // Verify: Map is empty
          return loadedMappings.size === 0;
        }
      ),
      { numRuns: 10 }
    );
  });
});
