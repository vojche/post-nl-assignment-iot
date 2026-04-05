import { EventLoader } from '../src/loader/EventLoader';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import { createGzip } from 'zlib';
import { IoTEvent } from '../src/models/types';

const s3Mock = mockClient(S3Client);

describe('EventLoader', () => {
  let eventLoader: EventLoader;
  const bucketName = 'test-bucket';
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    s3Mock.reset();
    const s3Client = new S3Client({ region: 'us-east-1' });
    eventLoader = new EventLoader(s3Client, bucketName);
    // Reset console.error spy before each test
    if (consoleErrorSpy) {
      consoleErrorSpy.mockRestore();
    }
  });

  afterEach(() => {
    // Clean up console.error spy after each test
    if (consoleErrorSpy) {
      consoleErrorSpy.mockRestore();
    }
  });

  describe('loadEventsForDate', () => {
    it('should load events for a given date', async () => {
      // Mock S3 ListObjectsV2
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
        ],
      });

      // Create test events
      const testEvents: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.370800,
          longitude: 4.895200,
          timestamp: '2024-01-15T10:00:15Z',
        },
      ];

      // Create GZIP compressed newline-delimited JSON
      const jsonLines = testEvents.map(e => JSON.stringify(e)).join('\n');
      const gzipStream = await compressString(jsonLines);

      // Mock S3 GetObject
      s3Mock.on(GetObjectCommand).resolves({
        Body: gzipStream as any,
      });

      // Load events
      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Verify
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(testEvents[0]);
      expect(events[1]).toEqual(testEvents[1]);
    });

    it('should handle multiple S3 objects for the same date', async () => {
      // Mock S3 ListObjectsV2
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
          { Key: 'events/year=2024/month=01/day=15/events-002.json.gz' },
        ],
      });

      // Create test events for each file
      const file1Events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
      ];

      const file2Events: IoTEvent[] = [
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.370800,
          longitude: 4.895200,
          timestamp: '2024-01-15T10:00:15Z',
        },
      ];

      // Mock S3 GetObject for each file
      s3Mock.on(GetObjectCommand, {
        Key: 'events/year=2024/month=01/day=15/events-001.json.gz',
      }).resolves({
        Body: await compressString(file1Events.map(e => JSON.stringify(e)).join('\n')) as any,
      });

      s3Mock.on(GetObjectCommand, {
        Key: 'events/year=2024/month=01/day=15/events-002.json.gz',
      }).resolves({
        Body: await compressString(file2Events.map(e => JSON.stringify(e)).join('\n')) as any,
      });

      // Load events
      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Verify
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(file1Events[0]);
      expect(events[1]).toEqual(file2Events[0]);
    });

    it('should skip invalid events and log errors', async () => {
      // Mock console.error
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock S3 ListObjectsV2
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
        ],
      });

      // Create test events with one invalid event
      const validEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const invalidEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-02',
        latitude: 91.0, // Invalid latitude
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:15Z',
      };

      const jsonLines = [JSON.stringify(validEvent), JSON.stringify(invalidEvent)].join('\n');
      const gzipStream = await compressString(jsonLines);

      // Mock S3 GetObject
      s3Mock.on(GetObjectCommand).resolves({
        Body: gzipStream as any,
      });

      // Load events
      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Verify
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(validEvent);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Invalid latitude: 91 for device VV-AA-AA-AA-02')
      );
    });

    it('should skip events with missing required fields', async () => {
      // Mock console.error
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock S3 ListObjectsV2
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
        ],
      });

      // Create test events with one missing deviceId
      const validEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const invalidEvent = {
        deviceType: 'vehicle',
        // Missing deviceId
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:15Z',
      };

      const jsonLines = [JSON.stringify(validEvent), JSON.stringify(invalidEvent)].join('\n');
      const gzipStream = await compressString(jsonLines);

      // Mock S3 GetObject
      s3Mock.on(GetObjectCommand).resolves({
        Body: gzipStream as any,
      });

      // Load events
      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Verify
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(validEvent);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Missing required fields'),
        expect.any(Object)
      );
    });

    it('should handle empty S3 response', async () => {
      // Mock S3 ListObjectsV2 with no objects
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [],
      });

      // Load events
      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Verify
      expect(events).toHaveLength(0);
    });

    it('should handle S3 pagination', async () => {
      // Mock S3 ListObjectsV2 with pagination
      s3Mock.on(ListObjectsV2Command)
        .resolvesOnce({
          Contents: [
            { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
          ],
          NextContinuationToken: 'token-1',
        })
        .resolvesOnce({
          Contents: [
            { Key: 'events/year=2024/month=01/day=15/events-002.json.gz' },
          ],
        });

      // Create test events
      const event1: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const event2: IoTEvent = {
        deviceType: 'handheld',
        deviceId: 'HH-BB-BB-BB-01',
        latitude: 52.370800,
        longitude: 4.895200,
        timestamp: '2024-01-15T10:00:15Z',
      };

      // Mock S3 GetObject for each file
      s3Mock.on(GetObjectCommand, {
        Key: 'events/year=2024/month=01/day=15/events-001.json.gz',
      }).resolves({
        Body: await compressString(JSON.stringify(event1)) as any,
      });

      s3Mock.on(GetObjectCommand, {
        Key: 'events/year=2024/month=01/day=15/events-002.json.gz',
      }).resolves({
        Body: await compressString(JSON.stringify(event2)) as any,
      });

      // Load events
      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Verify
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(event1);
      expect(events[1]).toEqual(event2);
    });
  });

  describe('streamEventsForDate', () => {
    it('should stream events one at a time', async () => {
      // Mock S3 ListObjectsV2
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
        ],
      });

      // Create test events
      const testEvents: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.370800,
          longitude: 4.895200,
          timestamp: '2024-01-15T10:00:15Z',
        },
      ];

      const jsonLines = testEvents.map(e => JSON.stringify(e)).join('\n');
      const gzipStream = await compressString(jsonLines);

      // Mock S3 GetObject
      s3Mock.on(GetObjectCommand).resolves({
        Body: gzipStream as any,
      });

      // Stream events
      const events: IoTEvent[] = [];
      for await (const event of eventLoader.streamEventsForDate('2024-01-15')) {
        events.push(event);
      }

      // Verify
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(testEvents[0]);
      expect(events[1]).toEqual(testEvents[1]);
    });

    it('should support filtering events', async () => {
      // Mock S3 ListObjectsV2
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
        ],
      });

      // Create test events
      const testEvents: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.370800,
          longitude: 4.895200,
          timestamp: '2024-01-15T10:00:15Z',
        },
      ];

      const jsonLines = testEvents.map(e => JSON.stringify(e)).join('\n');
      const gzipStream = await compressString(jsonLines);

      // Mock S3 GetObject
      s3Mock.on(GetObjectCommand).resolves({
        Body: gzipStream as any,
      });

      // Stream events with filter (only vehicles)
      const events: IoTEvent[] = [];
      for await (const event of eventLoader.streamEventsForDate('2024-01-15', e => e.deviceType === 'vehicle')) {
        events.push(event);
      }

      // Verify
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(testEvents[0]);
    });
  });

  describe('error handling', () => {
    it('should handle S3 read failures gracefully', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock S3 ListObjectsV2 to return a key
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
        ],
      });

      // Mock S3 GetObject to fail
      s3Mock.on(GetObjectCommand).rejects(new Error('S3 read failure'));

      // Load events should not throw, but return empty array
      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Failed to stream S3 object'),
        expect.any(Error)
      );
    });

    it('should handle S3 ListObjects failures gracefully', async () => {
      // Mock S3 ListObjectsV2 to fail
      s3Mock.on(ListObjectsV2Command).rejects(new Error('S3 list failure'));

      // Load events should throw since we cannot list objects
      await expect(eventLoader.loadEventsForDate('2024-01-15')).rejects.toThrow('S3 list failure');
    });

    it('should handle JSON parse errors and continue processing', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      // Create data with invalid JSON line and valid event
      const validEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const mixedData = `{invalid json}\n${JSON.stringify(validEvent)}`;
      const gzipStream = await compressString(mixedData);

      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Should skip invalid JSON and process valid event
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(validEvent);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Failed to parse JSON line'),
        expect.any(Error)
      );
    });

    it('should handle malformed GZIP data gracefully', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      // Create non-GZIP data (will fail decompression)
      const invalidGzipStream = Readable.from(Buffer.from('not gzip data'));

      s3Mock.on(GetObjectCommand).resolves({ Body: invalidGzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Should handle gracefully and return empty array
      expect(events).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle empty GZIP files', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      // Create empty GZIP file
      const emptyGzipStream = await compressString('');

      s3Mock.on(GetObjectCommand).resolves({ Body: emptyGzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(0);
    });

    it('should handle S3 objects with no body', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      // Mock S3 GetObject with no body
      s3Mock.on(GetObjectCommand).resolves({ Body: undefined });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] No body in S3 object')
      );
    });

    it('should handle multiple S3 files with mixed success and failure', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
          { Key: 'events/year=2024/month=01/day=15/events-002.json.gz' },
        ],
      });

      const validEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      // First file succeeds
      s3Mock.on(GetObjectCommand, {
        Key: 'events/year=2024/month=01/day=15/events-001.json.gz',
      }).resolves({
        Body: await compressString(JSON.stringify(validEvent)) as any,
      });

      // Second file fails
      s3Mock.on(GetObjectCommand, {
        Key: 'events/year=2024/month=01/day=15/events-002.json.gz',
      }).rejects(new Error('S3 read failure'));

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Should process first file successfully despite second file failure
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(validEvent);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Failed to stream S3 object'),
        expect.any(Error)
      );
    });

    it('should handle large event files with pagination', async () => {
      // Mock S3 ListObjectsV2 with pagination (simulating 10 files across 2 pages)
      s3Mock.on(ListObjectsV2Command)
        .resolvesOnce({
          Contents: Array.from({ length: 5 }, (_, i) => ({
            Key: `events/year=2024/month=01/day=15/events-${String(i).padStart(4, '0')}.json.gz`,
          })),
          NextContinuationToken: 'token-1',
        })
        .resolvesOnce({
          Contents: Array.from({ length: 5 }, (_, i) => ({
            Key: `events/year=2024/month=01/day=15/events-${String(i + 5).padStart(4, '0')}.json.gz`,
          })),
        });

      const testEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      // Mock all GetObject calls to return a fresh compressed stream each time
      s3Mock.on(GetObjectCommand).callsFake(async () => ({
        Body: await compressString(JSON.stringify(testEvent)) as any,
      }));

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Should process all 10 files (5 from first page + 5 from second page)
      expect(events).toHaveLength(10);
    });

    it('should skip non-gzip files in S3 listing', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'events/year=2024/month=01/day=15/events-001.json.gz' },
          { Key: 'events/year=2024/month=01/day=15/events-002.json' }, // Not .gz
          { Key: 'events/year=2024/month=01/day=15/metadata.txt' }, // Not JSON
        ],
      });

      const testEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      s3Mock.on(GetObjectCommand).resolves({
        Body: await compressString(JSON.stringify(testEvent)) as any,
      });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      // Should only process the .json.gz file
      expect(events).toHaveLength(1);
    });
  });

  describe('validation', () => {
    it('should reject events with invalid deviceType', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const invalidEvent = {
        deviceType: 'invalid',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const gzipStream = await compressString(JSON.stringify(invalidEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Invalid deviceType: invalid for device VV-AA-AA-AA-01')
      );
    });

    it('should reject events with latitude > 90', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const invalidEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 91.0,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const gzipStream = await compressString(JSON.stringify(invalidEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Invalid latitude: 91 for device VV-AA-AA-AA-01')
      );
    });

    it('should reject events with latitude < -90', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const invalidEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: -91.0,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const gzipStream = await compressString(JSON.stringify(invalidEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Invalid latitude: -91 for device VV-AA-AA-AA-01')
      );
    });

    it('should reject events with longitude > 180', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const invalidEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 181.0,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const gzipStream = await compressString(JSON.stringify(invalidEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Invalid longitude: 181 for device VV-AA-AA-AA-01')
      );
    });

    it('should reject events with longitude < -180', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const invalidEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: -181.0,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const gzipStream = await compressString(JSON.stringify(invalidEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Invalid longitude: -181 for device VV-AA-AA-AA-01')
      );
    });

    it('should accept events with latitude = 90', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const validEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 90.0,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const gzipStream = await compressString(JSON.stringify(validEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(validEvent);
    });

    it('should accept events with latitude = -90', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const validEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: -90.0,
        longitude: 4.895168,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const gzipStream = await compressString(JSON.stringify(validEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(validEvent);
    });

    it('should accept events with longitude = 180', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const validEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 180.0,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const gzipStream = await compressString(JSON.stringify(validEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(validEvent);
    });

    it('should accept events with longitude = -180', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const validEvent: IoTEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: -180.0,
        timestamp: '2024-01-15T10:00:00Z',
      };

      const gzipStream = await compressString(JSON.stringify(validEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(validEvent);
    });

    it('should reject events with invalid timestamp', async () => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'events/year=2024/month=01/day=15/events-001.json.gz' }],
      });

      const invalidEvent = {
        deviceType: 'vehicle',
        deviceId: 'VV-AA-AA-AA-01',
        latitude: 52.370216,
        longitude: 4.895168,
        timestamp: 'invalid-timestamp',
      };

      const gzipStream = await compressString(JSON.stringify(invalidEvent));
      s3Mock.on(GetObjectCommand).resolves({ Body: gzipStream as any });

      const events = await eventLoader.loadEventsForDate('2024-01-15');

      expect(events).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventLoader] Invalid timestamp: invalid-timestamp for device VV-AA-AA-AA-01')
      );
    });
  });
});

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
