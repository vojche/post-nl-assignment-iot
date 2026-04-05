/**
 * Property-Based Tests for Invalid Event Rejection
 * 
 * **Property 2: Invalid Event Rejection**
 * **Validates: Requirements 1.2, 1.3, 2.2, 2.3, 10.1, 10.2, 10.3, 10.4, 10.5**
 * 
 * These tests verify that the EventLoader correctly rejects all invalid events
 * and logs appropriate error messages. Invalid events include:
 * - Missing required fields (deviceType, deviceId, latitude, longitude, timestamp)
 * - Invalid coordinates (latitude outside [-90, 90], longitude outside [-180, 180])
 * - Invalid deviceType (not 'vehicle' or 'handheld')
 * - Malformed timestamps (not valid ISO 8601)
 */

import * as fc from 'fast-check';
import { EventLoader } from '../src/loader/EventLoader';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import { createGzip } from 'zlib';

const s3Mock = mockClient(S3Client);

/**
 * Helper function to compress a string using GZIP
 */
async function compressString(data: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gzip = createGzip();

    gzip.on('data', (chunk) => chunks.push(chunk));
    gzip.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const readable = Readable.from(buffer);
      resolve(readable);
    });
    gzip.on('error', reject);

    gzip.write(data);
    gzip.end();
  });
}

/**
 * Arbitrary generator for events with missing required fields
 */
const eventWithMissingFieldsArbitrary = (): fc.Arbitrary<any> => {
  return fc.oneof(
    // Missing deviceType
    fc.record({
      deviceId: fc.string({ minLength: 1 }),
      latitude: fc.double({ min: -90, max: 90 }),
      longitude: fc.double({ min: -180, max: 180 }),
      timestamp: fc.date().map(d => d.toISOString())
    }),
    // Missing deviceId
    fc.record({
      deviceType: fc.constantFrom('vehicle', 'handheld'),
      latitude: fc.double({ min: -90, max: 90 }),
      longitude: fc.double({ min: -180, max: 180 }),
      timestamp: fc.date().map(d => d.toISOString())
    }),
    // Missing latitude
    fc.record({
      deviceType: fc.constantFrom('vehicle', 'handheld'),
      deviceId: fc.string({ minLength: 1 }),
      longitude: fc.double({ min: -180, max: 180 }),
      timestamp: fc.date().map(d => d.toISOString())
    }),
    // Missing longitude
    fc.record({
      deviceType: fc.constantFrom('vehicle', 'handheld'),
      deviceId: fc.string({ minLength: 1 }),
      latitude: fc.double({ min: -90, max: 90 }),
      timestamp: fc.date().map(d => d.toISOString())
    }),
    // Missing timestamp
    fc.record({
      deviceType: fc.constantFrom('vehicle', 'handheld'),
      deviceId: fc.string({ minLength: 1 }),
      latitude: fc.double({ min: -90, max: 90 }),
      longitude: fc.double({ min: -180, max: 180 })
    })
  );
};

/**
 * Arbitrary generator for events with invalid coordinates
 */
const eventWithInvalidCoordinatesArbitrary = (): fc.Arbitrary<any> => {
  return fc.oneof(
    // Invalid latitude (> 90)
    fc.record({
      deviceType: fc.constantFrom('vehicle', 'handheld'),
      deviceId: fc.string({ minLength: 1 }),
      latitude: fc.double({ min: 90.000001, max: 180, noNaN: true }),
      longitude: fc.double({ min: -180, max: 180 }),
      timestamp: fc.date().map(d => d.toISOString())
    }),
    // Invalid latitude (< -90)
    fc.record({
      deviceType: fc.constantFrom('vehicle', 'handheld'),
      deviceId: fc.string({ minLength: 1 }),
      latitude: fc.double({ min: -180, max: -90.000001, noNaN: true }),
      longitude: fc.double({ min: -180, max: 180 }),
      timestamp: fc.date().map(d => d.toISOString())
    }),
    // Invalid longitude (> 180)
    fc.record({
      deviceType: fc.constantFrom('vehicle', 'handheld'),
      deviceId: fc.string({ minLength: 1 }),
      latitude: fc.double({ min: -90, max: 90, noNaN: true }),
      longitude: fc.double({ min: 180.000001, max: 360, noNaN: true }),
      timestamp: fc.date().map(d => d.toISOString())
    }),
    // Invalid longitude (< -180)
    fc.record({
      deviceType: fc.constantFrom('vehicle', 'handheld'),
      deviceId: fc.string({ minLength: 1 }),
      latitude: fc.double({ min: -90, max: 90, noNaN: true }),
      longitude: fc.double({ min: -360, max: -180.000001, noNaN: true }),
      timestamp: fc.date().map(d => d.toISOString())
    })
  );
};

/**
 * Arbitrary generator for events with invalid deviceType
 */
const eventWithInvalidDeviceTypeArbitrary = (): fc.Arbitrary<any> => {
  return fc.record({
    deviceType: fc.oneof(
      fc.constant(''),
      fc.constant('car'),
      fc.constant('device'),
      fc.constant('VEHICLE'),
      fc.constant('HANDHELD'),
      fc.string({ minLength: 1 }).filter(s => s !== 'vehicle' && s !== 'handheld')
    ),
    deviceId: fc.string({ minLength: 1 }),
    latitude: fc.double({ min: -90, max: 90 }),
    longitude: fc.double({ min: -180, max: 180 }),
    timestamp: fc.date().map(d => d.toISOString())
  });
};

/**
 * Arbitrary generator for events with malformed timestamps
 */
const eventWithMalformedTimestampArbitrary = (): fc.Arbitrary<any> => {
  return fc.record({
    deviceType: fc.constantFrom('vehicle', 'handheld'),
    deviceId: fc.string({ minLength: 1 }),
    latitude: fc.double({ min: -90, max: 90, noNaN: true }),
    longitude: fc.double({ min: -180, max: 180, noNaN: true }),
    timestamp: fc.constantFrom(
      'invalid-timestamp',
      'not-a-date',
      'abc123',
      'INVALID',
      '####',
      'xyz-123-abc'
    )
  });
};

describe('Invalid Event Rejection - Property Tests', () => {
  let eventLoader: EventLoader;
  let consoleErrorSpy: jest.SpyInstance;
  const bucketName = 'test-bucket';

  beforeEach(() => {
    s3Mock.reset();
    const s3Client = new S3Client({ region: 'us-east-1' });
    eventLoader = new EventLoader(s3Client, bucketName);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  /**
   * Property 2a: Events with missing required fields are rejected
   * 
   * **Validates: Requirements 1.2, 1.3, 2.2, 2.3, 10.1**
   */
  describe('Property 2a: Missing Required Fields', () => {
    it('should reject all events with missing required fields and log errors', async () => {
      await fc.assert(
        fc.asyncProperty(eventWithMissingFieldsArbitrary(), async (invalidEvent) => {
          // Setup S3 mock
          s3Mock.on(ListObjectsV2Command).resolves({
            Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
          });

          const gzipStream = await compressString(JSON.stringify(invalidEvent));
          s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

          // Clear previous spy calls
          consoleErrorSpy.mockClear();

          // Load events
          const events = await eventLoader.loadEventsForDate('2024-01-15');

          // Verify event was rejected
          const wasRejected = events.length === 0;

          // Verify error was logged
          const errorLogged = consoleErrorSpy.mock.calls.some(call => 
            call[0].includes('[EventLoader]') && call[0].includes('Missing required fields')
          );

          return wasRejected && errorLogged;
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 2b: Events with invalid coordinates are rejected
   * 
   * **Validates: Requirements 10.1, 10.2, 10.4, 10.5**
   */
  describe('Property 2b: Invalid Coordinates', () => {
    it('should reject all events with invalid coordinates and log errors', async () => {
      await fc.assert(
        fc.asyncProperty(eventWithInvalidCoordinatesArbitrary(), async (invalidEvent) => {
          // Setup S3 mock
          s3Mock.on(ListObjectsV2Command).resolves({
            Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
          });

          const gzipStream = await compressString(JSON.stringify(invalidEvent));
          s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

          // Clear previous spy calls
          consoleErrorSpy.mockClear();

          // Load events
          const events = await eventLoader.loadEventsForDate('2024-01-15');

          // Verify event was rejected
          const wasRejected = events.length === 0;

          // Verify error was logged (either latitude or longitude error)
          const errorLogged = consoleErrorSpy.mock.calls.some(call => 
            call[0].includes('[EventLoader]') && 
            (call[0].includes('Invalid latitude') || call[0].includes('Invalid longitude'))
          );

          return wasRejected && errorLogged;
        }),
        { numRuns: 50 }
      );
    });

    it('should reject latitude values outside [-90, 90] range', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('vehicle', 'handheld'),
          fc.string({ minLength: 1 }),
          fc.oneof(
            fc.double({ min: 90.000001, max: 180, noNaN: true }),
            fc.double({ min: -180, max: -90.000001, noNaN: true })
          ),
          fc.double({ min: -180, max: 180 }),
          fc.date().map(d => d.toISOString()),
          async (deviceType, deviceId, latitude, longitude, timestamp) => {
            const invalidEvent = { deviceType, deviceId, latitude, longitude, timestamp };

            // Setup S3 mock
            s3Mock.on(ListObjectsV2Command).resolves({
              Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
            });

            const gzipStream = await compressString(JSON.stringify(invalidEvent));
            s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

            consoleErrorSpy.mockClear();

            // Load events
            const events = await eventLoader.loadEventsForDate('2024-01-15');

            // Verify rejection and error logging
            const wasRejected = events.length === 0;
            const errorLogged = consoleErrorSpy.mock.calls.some(call => 
              call[0].includes('[EventLoader]') && call[0].includes('Invalid latitude')
            );

            return wasRejected && errorLogged;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should reject longitude values outside [-180, 180] range', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('vehicle', 'handheld'),
          fc.string({ minLength: 1 }),
          fc.double({ min: -90, max: 90 }),
          fc.oneof(
            fc.double({ min: 180.000001, max: 360, noNaN: true }),
            fc.double({ min: -360, max: -180.000001, noNaN: true })
          ),
          fc.date().map(d => d.toISOString()),
          async (deviceType, deviceId, latitude, longitude, timestamp) => {
            const invalidEvent = { deviceType, deviceId, latitude, longitude, timestamp };

            // Setup S3 mock
            s3Mock.on(ListObjectsV2Command).resolves({
              Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
            });

            const gzipStream = await compressString(JSON.stringify(invalidEvent));
            s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

            consoleErrorSpy.mockClear();

            // Load events
            const events = await eventLoader.loadEventsForDate('2024-01-15');

            // Verify rejection and error logging
            const wasRejected = events.length === 0;
            const errorLogged = consoleErrorSpy.mock.calls.some(call => 
              call[0].includes('[EventLoader]') && call[0].includes('Invalid longitude')
            );

            return wasRejected && errorLogged;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 2c: Events with invalid deviceType are rejected
   * 
   * **Validates: Requirements 1.2, 2.2, 10.3**
   */
  describe('Property 2c: Invalid DeviceType', () => {
    it('should reject all events with invalid deviceType and log errors', async () => {
      await fc.assert(
        fc.asyncProperty(eventWithInvalidDeviceTypeArbitrary(), async (invalidEvent) => {
          // Setup S3 mock
          s3Mock.on(ListObjectsV2Command).resolves({
            Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
          });

          const gzipStream = await compressString(JSON.stringify(invalidEvent));
          s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

          // Clear previous spy calls
          consoleErrorSpy.mockClear();

          // Load events
          const events = await eventLoader.loadEventsForDate('2024-01-15');

          // Verify event was rejected
          const wasRejected = events.length === 0;

          // Verify error was logged (either "Invalid deviceType" or "Missing required fields" for empty string)
          const errorLogged = consoleErrorSpy.mock.calls.some(call => 
            call[0].includes('[EventLoader]') && 
            (call[0].includes('Invalid deviceType') || call[0].includes('Missing required fields'))
          );

          return wasRejected && errorLogged;
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 2d: Events with malformed timestamps are rejected
   * 
   * **Validates: Requirements 1.3, 2.3, 10.3**
   */
  describe('Property 2d: Malformed Timestamps', () => {
    it('should reject all events with malformed timestamps and log errors', async () => {
      await fc.assert(
        fc.asyncProperty(eventWithMalformedTimestampArbitrary(), async (invalidEvent) => {
          // Setup S3 mock
          s3Mock.on(ListObjectsV2Command).resolves({
            Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
          });

          const gzipStream = await compressString(JSON.stringify(invalidEvent));
          s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

          // Clear previous spy calls
          consoleErrorSpy.mockClear();

          // Load events
          const events = await eventLoader.loadEventsForDate('2024-01-15');

          // Verify event was rejected
          const wasRejected = events.length === 0;

          // Verify error was logged (either "Invalid timestamp" or "Missing required fields" for empty/missing timestamp)
          const errorLogged = consoleErrorSpy.mock.calls.some(call => 
            call[0].includes('[EventLoader]') && 
            (call[0].includes('Invalid timestamp') || call[0].includes('Missing required fields'))
          );

          return wasRejected && errorLogged;
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 2e: Mixed valid and invalid events - only valid events are returned
   * 
   * **Validates: Requirements 1.2, 1.3, 2.2, 2.3, 10.1, 10.2, 10.3, 10.4, 10.5**
   */
  describe('Property 2e: Mixed Valid and Invalid Events', () => {
    it('should accept valid events and reject invalid events in the same batch', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            deviceType: fc.constantFrom('vehicle' as const, 'handheld' as const),
            deviceId: fc.string({ minLength: 1 }),
            latitude: fc.double({ min: -90, max: 90 }),
            longitude: fc.double({ min: -180, max: 180 }),
            timestamp: fc.date().map(d => d.toISOString())
          }),
          eventWithMissingFieldsArbitrary(),
          async (validEvent, invalidEvent) => {
            // Setup S3 mock with both valid and invalid events
            s3Mock.on(ListObjectsV2Command).resolves({
              Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
            });

            const jsonLines = [
              JSON.stringify(validEvent),
              JSON.stringify(invalidEvent)
            ].join('\n');

            const gzipStream = await compressString(jsonLines);
            s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

            consoleErrorSpy.mockClear();

            // Load events
            const events = await eventLoader.loadEventsForDate('2024-01-15');

            // Verify only valid event was returned
            const onlyValidReturned = events.length === 1 && 
              events[0].deviceId === validEvent.deviceId;

            // Verify error was logged for invalid event
            const errorLogged = consoleErrorSpy.mock.calls.some(call => 
              call[0].includes('[EventLoader]')
            );

            return onlyValidReturned && errorLogged;
          }
        ),
        { numRuns: 20 }
      );
    }, 10000); // 10 second timeout
  });

  /**
   * Property 2f: All invalid events result in error logs
   * 
   * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**
   * 
   * This property verifies that every invalid event produces at least one error log entry.
   */
  describe('Property 2f: Error Logging Completeness', () => {
    it('should log errors for every invalid event processed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.oneof(
              eventWithMissingFieldsArbitrary(),
              eventWithInvalidCoordinatesArbitrary(),
              eventWithInvalidDeviceTypeArbitrary(),
              eventWithMalformedTimestampArbitrary()
            ),
            { minLength: 1, maxLength: 10 }
          ),
          async (invalidEvents) => {
            // Setup S3 mock
            s3Mock.on(ListObjectsV2Command).resolves({
              Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
            });

            const jsonLines = invalidEvents.map(e => JSON.stringify(e)).join('\n');
            const gzipStream = await compressString(jsonLines);
            s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

            consoleErrorSpy.mockClear();

            // Load events
            const events = await eventLoader.loadEventsForDate('2024-01-15');

            // Verify all events were rejected
            const allRejected = events.length === 0;

            // Verify at least one error was logged per invalid event
            const errorCount = consoleErrorSpy.mock.calls.filter(call => 
              call[0].includes('[EventLoader]')
            ).length;

            const errorsLogged = errorCount >= invalidEvents.length;

            return allRejected && errorsLogged;
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
