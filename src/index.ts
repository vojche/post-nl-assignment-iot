/**
 * Main Lambda Handler for IoT Proximity Alert System
 * 
 * Daily batch processor that:
 * 1. Loads vehicle-handheld mappings from DynamoDB
 * 2. Streams vehicle events from S3 and builds state timelines
 * 3. Streams handheld events and detects proximity violations
 * 4. Generates daily report with summary statistics
 * 5. Publishes report to SNS and stores in S3
 * 
 * **Validates: Requirements 7.1, 7.2, 7.4, 8.1, 8.2, 9.1, 9.2, 9.3, 9.4, 15.6**
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import * as AWSXRay from 'aws-xray-sdk-core';

import { EventLoader } from './loader/EventLoader';
import { MappingLoader } from './loader/MappingLoader';
import { DistanceCalculator } from './distance/DistanceCalculator';
import { VehicleStateAnalyzer } from './analyzer/VehicleStateAnalyzer';
import { ViolationDetector } from './detector/ViolationDetector';
import { ReportGenerator } from './generator/ReportGenerator';
import { ReportPublisher } from './publisher/ReportPublisher';
import { IoTEvent } from './models/types';

// Wrap AWS SDK clients with X-Ray tracing (disable in test environment)
const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

// Configure X-Ray to not throw errors in test environment
if (isTestEnvironment) {
  AWSXRay.setContextMissingStrategy('LOG_ERROR');
}

const s3Client = isTestEnvironment ? new S3Client({}) : AWSXRay.captureAWSv3Client(new S3Client({}));
const dynamoClient = isTestEnvironment ? new DynamoDBClient({}) : AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const sqsClient = isTestEnvironment ? new SQSClient({}) : AWSXRay.captureAWSv3Client(new SQSClient({}));
const cloudWatchClient = isTestEnvironment ? new CloudWatchClient({}) : AWSXRay.captureAWSv3Client(new CloudWatchClient({}));

// Helper function to get environment variables (allows dynamic reading in tests)
function getEnvVar(name: string, defaultValue: string = ''): string {
  return process.env[name] || defaultValue;
}

function getEnvVarInt(name: string, defaultValue: number): number {
  return parseInt(process.env[name] || String(defaultValue), 10);
}

/**
 * Lambda handler input event from EventBridge
 */
interface HandlerEvent {
  processingDate: string; // YYYY-MM-DD format
}

/**
 * Lambda handler response
 */
interface HandlerResponse {
  statusCode: number;
  body: string;
}

/**
 * Main Lambda handler
 */
export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const startTime = Date.now();
  console.log('[Handler] Starting batch processing', { event });

  // Read environment variables dynamically
  const EVENT_BUCKET_NAME = getEnvVar('EVENT_BUCKET_NAME');
  const REPORT_BUCKET_NAME = getEnvVar('REPORT_BUCKET_NAME');
  const VEHICLE_HANDHELD_TABLE_NAME = getEnvVar('VEHICLE_HANDHELD_TABLE_NAME');
  const NOTIFICATION_TOPIC_ARN = getEnvVar('NOTIFICATION_TOPIC_ARN');
  const DISTANCE_THRESHOLD_METERS = getEnvVarInt('DISTANCE_THRESHOLD_METERS', 50);
  const VEHICLE_STATIC_THRESHOLD_METERS = getEnvVarInt('VEHICLE_STATIC_THRESHOLD_METERS', 10);
  const VEHICLE_STATIC_THRESHOLD_SECONDS = getEnvVarInt('VEHICLE_STATIC_THRESHOLD_SECONDS', 120);
  const VEHICLE_STALENESS_THRESHOLD_SECONDS = getEnvVarInt('VEHICLE_STALENESS_THRESHOLD_SECONDS', 300);

  try {
    // Validate input
    const processingDate = parseProcessingDate(event);
    console.log(`[Handler] Processing date: ${processingDate}`);

    // Check for idempotency marker
    const alreadyProcessed = await checkIdempotency(processingDate);
    if (alreadyProcessed) {
      console.log(`[Handler] Job already processed for ${processingDate}, skipping`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Job already processed', processingDate }),
      };
    }

    // Initialize components
    const eventLoader = new EventLoader(s3Client, EVENT_BUCKET_NAME);
    const mappingLoader = new MappingLoader(dynamoClient, VEHICLE_HANDHELD_TABLE_NAME);
    const distanceCalculator = new DistanceCalculator();
    const vehicleStateAnalyzer = new VehicleStateAnalyzer(
      distanceCalculator,
      VEHICLE_STATIC_THRESHOLD_METERS,
      VEHICLE_STATIC_THRESHOLD_SECONDS,
      VEHICLE_STALENESS_THRESHOLD_SECONDS
    );
    const violationDetector = new ViolationDetector(
      distanceCalculator,
      vehicleStateAnalyzer,
      DISTANCE_THRESHOLD_METERS
    );
    const reportGenerator = new ReportGenerator();
    const reportPublisher = new ReportPublisher({
      snsTopicArn: NOTIFICATION_TOPIC_ARN,
      s3BucketName: REPORT_BUCKET_NAME,
    });

    // Phase 0: Load vehicle-handheld mappings (handheldId → vehicleId)
    console.log('[Handler] Phase 0: Loading vehicle-handheld mappings');
    const mappings = isTestEnvironment
      ? await mappingLoader.loadAllMappings()
      : await AWSXRay.captureAsyncFunc('LoadMappings', async (subsegment) => {
          const result = await mappingLoader.loadAllMappings();
          subsegment?.addAnnotation('mappingCount', result.size);
          return result;
        });

    // Phase 1: Build vehicle state timelines
    console.log('[Handler] Phase 1: Building vehicle state timelines');
    const { vehicleTimelines, vehicleEventCount } = isTestEnvironment
      ? await (async () => {
          const vehicleEvents: IoTEvent[] = [];
          for await (const event of eventLoader.streamEventsForDate(
            processingDate,
            (e) => e.deviceType === 'vehicle'
          )) {
            vehicleEvents.push(event);
          }
          const timelines = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
          return {
            vehicleTimelines: timelines,
            vehicleEventCount: vehicleEvents.length,
          };
        })()
      : await AWSXRay.captureAsyncFunc(
          'BuildVehicleTimelines',
          async (subsegment) => {
            const vehicleEvents: IoTEvent[] = [];
            
            // Stream vehicle events
            for await (const event of eventLoader.streamEventsForDate(
              processingDate,
              (e) => e.deviceType === 'vehicle'
            )) {
              vehicleEvents.push(event);
            }

            subsegment?.addAnnotation('vehicleEventCount', vehicleEvents.length);
            
            // Build timelines
            const timelines = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
            
            return {
              vehicleTimelines: timelines,
              vehicleEventCount: vehicleEvents.length,
            };
          }
        );

    // Phase 2: Process handheld events and detect violations
    console.log('[Handler] Phase 2: Processing handheld events and detecting violations');
    const { violations, handheldEventCount } = isTestEnvironment
      ? await (async () => {
          const handheldEvents: IoTEvent[] = [];
          for await (const event of eventLoader.streamEventsForDate(
            processingDate,
            (e) => e.deviceType === 'handheld'
          )) {
            handheldEvents.push(event);
          }
          const detectedViolations = violationDetector.detectViolations(
            handheldEvents,
            vehicleTimelines,
            mappings
          );
          return {
            violations: detectedViolations,
            handheldEventCount: handheldEvents.length,
          };
        })()
      : await AWSXRay.captureAsyncFunc(
          'DetectViolations',
          async (subsegment) => {
            const handheldEvents: IoTEvent[] = [];
            
            // Stream handheld events
            for await (const event of eventLoader.streamEventsForDate(
              processingDate,
              (e) => e.deviceType === 'handheld'
            )) {
              handheldEvents.push(event);
            }

            subsegment?.addAnnotation('handheldEventCount', handheldEvents.length);
            
            // Detect violations
            const detectedViolations = violationDetector.detectViolations(
              handheldEvents,
              vehicleTimelines,
              mappings
            );

            subsegment?.addAnnotation('violationCount', detectedViolations.length);
            
            return {
              violations: detectedViolations,
              handheldEventCount: handheldEvents.length,
            };
          }
        );

    // Phase 3: Generate and publish report
    console.log('[Handler] Phase 3: Generating and publishing report');
    const processingDuration = Date.now() - startTime;
    const totalEvents = vehicleEventCount + handheldEventCount;

    const report = reportGenerator.generateReport(processingDate, violations, {
      processingDuration,
      eventsProcessed: totalEvents,
      eventsSkipped: 0, // TODO: Track skipped events
      devicesWithNoData: {
        vehicles: [],
        handhelds: [],
      },
    });

    // Publish to SNS
    if (isTestEnvironment) {
      await reportPublisher.publishToSNS(report);
    } else {
      await AWSXRay.captureAsyncFunc('PublishToSNS', async () => {
        await reportPublisher.publishToSNS(report);
      });
    }

    // Store in S3
    if (isTestEnvironment) {
      await reportPublisher.storeInS3(report);
    } else {
      await AWSXRay.captureAsyncFunc('StoreInS3', async () => {
        await reportPublisher.storeInS3(report);
      });
    }

    // Store idempotency marker
    await storeIdempotencyMarker(processingDate);

    // Emit CloudWatch metrics
    await emitMetrics(processingDate, {
      processingDuration,
      totalEvents,
      violationCount: violations.length,
    });

    console.log('[Handler] Batch processing completed successfully', {
      processingDate,
      totalEvents,
      violations: violations.length,
      duration: processingDuration,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Batch processing completed',
        processingDate,
        summary: report.summary,
      }),
    };
  } catch (error) {
    console.error('[Handler] Batch processing failed:', error);

    // Send to DLQ
    await sendToDLQ(event, error as Error);

    // Emit failure metric
    await emitFailureMetric();

    throw error;
  }
}

/**
 * Parse processing date from event
 * Handles both direct date string and EventBridge time field
 */
function parseProcessingDate(event: HandlerEvent): string {
  if (event.processingDate) {
    // Direct date string (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(event.processingDate)) {
      return event.processingDate;
    }
    
    // ISO 8601 timestamp from EventBridge
    const date = new Date(event.processingDate);
    if (!isNaN(date.getTime())) {
      // Get previous day (since we run at 2 AM)
      date.setDate(date.getDate() - 1);
      return date.toISOString().split('T')[0];
    }
  }

  throw new Error('Invalid processingDate in event');
}

/**
 * Check if job has already been processed (idempotency)
 */
async function checkIdempotency(processingDate: string): Promise<boolean> {
  const EVENT_BUCKET_NAME = getEnvVar('EVENT_BUCKET_NAME');
  const key = `completed-jobs/${processingDate}.marker`;

  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: EVENT_BUCKET_NAME,
      Key: key,
    }));
    return true; // Marker exists
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false; // Marker doesn't exist
    }
    throw error; // Other error
  }
}

/**
 * Store idempotency marker in S3
 */
async function storeIdempotencyMarker(processingDate: string): Promise<void> {
  const EVENT_BUCKET_NAME = getEnvVar('EVENT_BUCKET_NAME');
  const key = `completed-jobs/${processingDate}.marker`;

  await s3Client.send(new PutObjectCommand({
    Bucket: EVENT_BUCKET_NAME,
    Key: key,
    Body: JSON.stringify({
      processingDate,
      completedAt: new Date().toISOString(),
    }),
    ContentType: 'application/json',
  }));

  console.log(`[Handler] Stored idempotency marker: ${key}`);
}

/**
 * Send failed job to Dead Letter Queue
 */
async function sendToDLQ(event: HandlerEvent, error: Error): Promise<void> {
  const DEAD_LETTER_QUEUE_URL = getEnvVar('DEAD_LETTER_QUEUE_URL');
  
  if (!DEAD_LETTER_QUEUE_URL) {
    console.warn('[Handler] DLQ URL not configured, skipping DLQ send');
    return;
  }

  try {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: DEAD_LETTER_QUEUE_URL,
      MessageBody: JSON.stringify({
        event,
        error: {
          message: error.message,
          stack: error.stack,
        },
        timestamp: new Date().toISOString(),
      }),
    }));

    console.log('[Handler] Sent failed job to DLQ');
  } catch (dlqError) {
    console.error('[Handler] Failed to send to DLQ:', dlqError);
  }
}

/**
 * Emit CloudWatch metrics
 */
async function emitMetrics(
  processingDate: string,
  metrics: {
    processingDuration: number;
    totalEvents: number;
    violationCount: number;
  }
): Promise<void> {
  try {
    await cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: 'ProximityAlert',
      MetricData: [
        {
          MetricName: 'EventProcessingDuration',
          Value: metrics.processingDuration,
          Unit: 'Milliseconds',
          Timestamp: new Date(),
          Dimensions: [
            { Name: 'Environment', Value: process.env.ENVIRONMENT || 'production' },
          ],
        },
        {
          MetricName: 'ProximityAlertCount',
          Value: metrics.violationCount,
          Unit: 'Count',
          Timestamp: new Date(),
          Dimensions: [
            { Name: 'Environment', Value: process.env.ENVIRONMENT || 'production' },
          ],
        },
        {
          MetricName: 'EventsProcessed',
          Value: metrics.totalEvents,
          Unit: 'Count',
          Timestamp: new Date(),
          Dimensions: [
            { Name: 'Environment', Value: process.env.ENVIRONMENT || 'production' },
          ],
        },
      ],
    }));

    console.log('[Handler] Emitted CloudWatch metrics');
  } catch (error) {
    console.error('[Handler] Failed to emit metrics:', error);
  }
}

/**
 * Emit failure metric
 */
async function emitFailureMetric(): Promise<void> {
  try {
    await cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: 'ProximityAlert',
      MetricData: [
        {
          MetricName: 'BatchProcessingFailure',
          Value: 1,
          Unit: 'Count',
          Timestamp: new Date(),
          Dimensions: [
            { Name: 'Environment', Value: process.env.ENVIRONMENT || 'production' },
          ],
        },
      ],
    }));
  } catch (error) {
    console.error('[Handler] Failed to emit failure metric:', error);
  }
}
