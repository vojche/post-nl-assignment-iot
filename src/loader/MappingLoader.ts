/**
 * MappingLoader for loading vehicle-handheld mappings from DynamoDB
 * 
 * Scans Vehicle2HandheldTable and loads all mappings into an in-memory Map
 * for O(1) lookups during batch processing.
 * 
 * Returns mapping in the direction needed for processing: handheldId → vehicleId
 * (reverse of DynamoDB table structure for efficient lookups)
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 */

import { DynamoDBClient, ScanCommand, ScanCommandInput } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

/**
 * MappingLoader interface
 */
export interface IMappingLoader {
  /**
   * Load all vehicle-handheld mappings from DynamoDB
   * Handles pagination automatically
   * @returns Map of handheldId to vehicleId (reverse of table structure for efficient lookups)
   */
  loadAllMappings(): Promise<Map<string, string>>;
}

/**
 * MappingLoader implementation
 * 
 * Scans DynamoDB table with pagination handling (1 MB per response)
 * Implements retry logic with exponential backoff (3 attempts)
 */
export class MappingLoader implements IMappingLoader {
  private dynamoClient: DynamoDBClient;
  private tableName: string;
  private maxRetries: number = 3;

  constructor(dynamoClient: DynamoDBClient, tableName: string) {
    this.dynamoClient = dynamoClient;
    this.tableName = tableName;
  }

  /**
   * Load all mappings from DynamoDB with pagination and retry logic
   */
  async loadAllMappings(): Promise<Map<string, string>> {
    const mappings = new Map<string, string>();
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
      // Retry logic for each scan operation
      let attempt = 0;
      let scanSuccess = false;

      while (!scanSuccess && attempt < this.maxRetries) {
        try {
          const scanInput: ScanCommandInput = {
            TableName: this.tableName,
            ExclusiveStartKey: lastEvaluatedKey,
          };

          const command = new ScanCommand(scanInput);
          const response = await this.dynamoClient.send(command);

          // Process items
          if (response.Items) {
            for (const item of response.Items) {
              const unmarshalled = unmarshall(item);
              
              // Extract vehicleId and handheldId
              // Store as handheldId → vehicleId (reverse of table structure)
              // This matches our lookup pattern: given handheldId, find vehicleId
              if (unmarshalled.vehicleId && unmarshalled.handheldId) {
                mappings.set(
                  unmarshalled.handheldId as string,  // KEY: handheldId
                  unmarshalled.vehicleId as string    // VALUE: vehicleId
                );
              } else {
                console.warn(`[MappingLoader] Skipping item with missing fields:`, unmarshalled);
              }
            }
          }

          // Update pagination key
          lastEvaluatedKey = response.LastEvaluatedKey 
            ? unmarshall(response.LastEvaluatedKey as any)
            : undefined;

          scanSuccess = true;

        } catch (error: any) {
          attempt++;
          
          if (attempt >= this.maxRetries) {
            console.error(`[MappingLoader] Failed to scan DynamoDB after ${this.maxRetries} attempts:`, error);
            throw new Error(`Failed to load mappings from DynamoDB: ${error.message}`);
          }

          // Exponential backoff: 100ms, 200ms, 400ms
          const backoffMs = 100 * Math.pow(2, attempt - 1);
          console.warn(`[MappingLoader] Scan failed (attempt ${attempt}/${this.maxRetries}), retrying in ${backoffMs}ms:`, error.message);
          
          await this.sleep(backoffMs);
        }
      }
    } while (lastEvaluatedKey);

    console.log(`[MappingLoader] Loaded ${mappings.size} vehicle-handheld mappings`);
    return mappings;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
