/**
 * Populate Test Data Script
 * 
 * This script populates the Vehicle2HandheldTable with test mappings
 * for 2000 vehicles and 2000 handhelds.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME || 'Vehicle2HandheldTable-production';
const NUM_DEVICES = parseInt(process.env.NUM_DEVICES || '2000', 10);
const BATCH_SIZE = 25; // DynamoDB batch write limit

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

async function populateTestData() {
  console.log(`📝 Populating ${TABLE_NAME} with ${NUM_DEVICES} vehicle-handheld mappings...`);

  const startTime = Date.now();
  let totalWritten = 0;

  // Generate mappings in batches
  for (let i = 0; i < NUM_DEVICES; i += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, NUM_DEVICES - i);
    const items = [];

    for (let j = 0; j < batchSize; j++) {
      const deviceNum = i + j + 1;
      const vehicleId = `VV-AA-AA-AA-${String(deviceNum).padStart(4, '0')}`;
      const handheldId = `HH-BB-BB-BB-${String(deviceNum).padStart(4, '0')}`;

      items.push({
        PutRequest: {
          Item: {
            vehicleId,
            handheldId,
            createdAt: new Date().toISOString(),
            active: true,
          },
        },
      });
    }

    // Write batch to DynamoDB
    try {
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: items,
          },
        })
      );

      totalWritten += items.length;
      
      // Progress indicator
      if (totalWritten % 100 === 0) {
        const progress = ((totalWritten / NUM_DEVICES) * 100).toFixed(1);
        process.stdout.write(`\r✓ Written ${totalWritten}/${NUM_DEVICES} mappings (${progress}%)`);
      }
    } catch (error) {
      console.error(`\n❌ Error writing batch starting at ${i}:`, error);
      throw error;
    }

    // Small delay to avoid throttling
    if (i + BATCH_SIZE < NUM_DEVICES) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ Successfully populated ${totalWritten} mappings in ${duration}s`);
  console.log(`\nExample mappings:`);
  console.log(`  VV-AA-AA-AA-0001 → HH-BB-BB-BB-0001`);
  console.log(`  VV-AA-AA-AA-0002 → HH-BB-BB-BB-0002`);
  console.log(`  ...`);
  console.log(`  VV-AA-AA-AA-${String(NUM_DEVICES).padStart(4, '0')} → HH-BB-BB-BB-${String(NUM_DEVICES).padStart(4, '0')}`);
}

// Run the script
populateTestData()
  .then(() => {
    console.log('\n🎉 Test data population complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed to populate test data:', error);
    process.exit(1);
  });
