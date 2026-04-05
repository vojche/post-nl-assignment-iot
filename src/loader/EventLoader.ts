import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import { IoTEvent } from '../models/types';

/**
 * EventLoader interface for loading IoT events from S3
 * Supports streaming to avoid loading all events into memory
 */
export interface IEventLoader {
  /**
   * Stream events for a given date with optional filtering
   * @param date - Date in YYYY-MM-DD format
   * @param filter - Optional filter function to select specific events
   * @returns AsyncIterable of IoTEvent objects
   */
  streamEventsForDate(date: string, filter?: (event: IoTEvent) => boolean): AsyncIterable<IoTEvent>;

  /**
   * Load all events for a given date (non-streaming)
   * @param date - Date in YYYY-MM-DD format
   * @returns Array of IoTEvent objects
   */
  loadEventsForDate(date: string): Promise<IoTEvent[]>;
}

/**
 * EventLoader implementation
 * Streams S3 files incrementally to avoid loading all events into memory
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
 */
export class EventLoader implements IEventLoader {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(s3Client: S3Client, bucketName: string) {
    this.s3Client = s3Client;
    this.bucketName = bucketName;
  }

  /**
   * Stream events for a given date with optional filtering
   * Uses AsyncIterable to yield events one at a time
   */
  async *streamEventsForDate(date: string, filter?: (event: IoTEvent) => boolean): AsyncIterable<IoTEvent> {
    // Parse date to extract year, month, day
    const [year, month, day] = date.split('-');
    const prefix = `events/year=${year}/month=${month}/day=${day}/`;

    // List all S3 objects for the given date
    const objectKeys = await this.listS3Objects(prefix);

    // Stream each S3 object
    for (const key of objectKeys) {
      yield* this.streamS3Object(key, filter);
    }
  }

  /**
   * Load all events for a given date (non-streaming)
   * Collects all events into an array
   */
  async loadEventsForDate(date: string): Promise<IoTEvent[]> {
    const events: IoTEvent[] = [];
    for await (const event of this.streamEventsForDate(date)) {
      events.push(event);
    }
    return events;
  }

  /**
   * List all S3 objects with the given prefix
   * Handles pagination automatically
   */
  private async listS3Objects(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const response = await this.s3Client.send(command);

      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.Key && object.Key.endsWith('.json.gz')) {
            keys.push(object.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  /**
   * Stream a single S3 object (GZIP compressed JSON)
   * Decompresses and parses newline-delimited JSON
   * Validates each event and yields valid events
   */
  private async *streamS3Object(key: string, filter?: (event: IoTEvent) => boolean): AsyncIterable<IoTEvent> {
    try {
      // Get S3 object
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        console.error(`[EventLoader] No body in S3 object: ${key}`);
        return;
      }

      // Convert Body to Node.js Readable stream
      const bodyStream = response.Body as Readable;

      // Create GZIP decompression stream
      const gunzip = createGunzip();
      bodyStream.pipe(gunzip);

      // Read decompressed data line by line
      let buffer = '';
      for await (const chunk of gunzip) {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        
        // Process all complete lines (keep last incomplete line in buffer)
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;

          try {
            const event = JSON.parse(line);
            const validatedEvent = this.validateEvent(event);

            if (validatedEvent) {
              // Apply filter if provided
              if (!filter || filter(validatedEvent)) {
                yield validatedEvent;
              }
            }
          } catch (error) {
            console.error(`[EventLoader] Failed to parse JSON line in ${key}:`, error);
            // Skip invalid JSON, continue processing
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim() !== '') {
        try {
          const event = JSON.parse(buffer);
          const validatedEvent = this.validateEvent(event);

          if (validatedEvent) {
            if (!filter || filter(validatedEvent)) {
              yield validatedEvent;
            }
          }
        } catch (error) {
          console.error(`[EventLoader] Failed to parse final JSON line in ${key}:`, error);
        }
      }
    } catch (error) {
      console.error(`[EventLoader] Failed to stream S3 object ${key}:`, error);
      // Continue processing other files
    }
  }

  /**
   * Validate an IoT event
   * Returns validated event if valid, null if invalid
   * 
   * **Validates: Requirements 1.2, 1.3, 2.2, 2.3**
   */
  private validateEvent(event: any): IoTEvent | null {
    // Check required fields
    if (!event.deviceType || !event.deviceId || 
        event.latitude === undefined || event.longitude === undefined || 
        !event.timestamp) {
      console.error(`[EventLoader] Missing required fields:`, {
        deviceType: event.deviceType,
        deviceId: event.deviceId,
        hasLatitude: event.latitude !== undefined,
        hasLongitude: event.longitude !== undefined,
        hasTimestamp: !!event.timestamp,
      });
      return null;
    }

    // Validate deviceType
    if (event.deviceType !== 'vehicle' && event.deviceType !== 'handheld') {
      console.error(`[EventLoader] Invalid deviceType: ${event.deviceType} for device ${event.deviceId}`);
      return null;
    }

    // Validate latitude
    if (typeof event.latitude !== 'number' || isNaN(event.latitude) || event.latitude < -90 || event.latitude > 90) {
      console.error(`[EventLoader] Invalid latitude: ${event.latitude} for device ${event.deviceId}`);
      return null;
    }

    // Validate longitude
    if (typeof event.longitude !== 'number' || isNaN(event.longitude) || event.longitude < -180 || event.longitude > 180) {
      console.error(`[EventLoader] Invalid longitude: ${event.longitude} for device ${event.deviceId}`);
      return null;
    }

    // Validate timestamp (basic ISO 8601 check)
    if (typeof event.timestamp !== 'string' || !this.isValidTimestamp(event.timestamp)) {
      console.error(`[EventLoader] Invalid timestamp: ${event.timestamp} for device ${event.deviceId}`);
      return null;
    }

    return {
      deviceType: event.deviceType,
      deviceId: event.deviceId,
      latitude: event.latitude,
      longitude: event.longitude,
      timestamp: event.timestamp,
    };
  }

  /**
   * Validate ISO 8601 timestamp format
   */
  private isValidTimestamp(timestamp: string): boolean {
    try {
      const date = new Date(timestamp);
      return !isNaN(date.getTime());
    } catch {
      return false;
    }
  }
}
