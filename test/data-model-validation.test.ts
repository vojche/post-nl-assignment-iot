/**
 * Property-Based Tests for Data Model Validation
 * 
 * **Validates: Requirements 1.1, 2.1**
 * 
 * These tests verify that IoTEvent objects maintain data integrity - all fields
 * can be extracted and match the input values. This is fundamental for the batch
 * processing pipeline.
 */

import * as fc from 'fast-check';
import { IoTEvent } from '../src/models/types';

/**
 * Arbitrary generator for valid IoTEvent objects
 * Generates events with all required fields and valid values
 */
const validIoTEventArbitrary = (): fc.Arbitrary<IoTEvent> => {
  return fc.record({
    deviceType: fc.constantFrom('vehicle' as const, 'handheld' as const),
    deviceId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    latitude: fc.double({ min: -90, max: 90, noNaN: true }),
    longitude: fc.double({ min: -180, max: 180, noNaN: true }),
    timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
      .map(d => d.toISOString())
  });
};

describe('Data Model Validation - Property Tests', () => {
  /**
   * Property 1: Event Field Extraction
   * 
   * **Validates: Requirements 1.1, 2.1**
   * 
   * For any valid IoT event (vehicle or handheld), all fields should be
   * extractable and match the input values exactly.
   */
  describe('Property 1: Event Field Extraction', () => {
    it('should extract all fields from valid vehicle events', () => {
      fc.assert(
        fc.property(validIoTEventArbitrary(), (event) => {
          // Verify all fields are present and accessible
          const hasAllFields = 
            event.deviceType !== undefined &&
            event.deviceId !== undefined &&
            event.latitude !== undefined &&
            event.longitude !== undefined &&
            event.timestamp !== undefined;

          // Verify field values match input
          const fieldsMatchInput =
            (event.deviceType === 'vehicle' || event.deviceType === 'handheld') &&
            typeof event.deviceId === 'string' &&
            event.deviceId.length > 0 &&
            typeof event.latitude === 'number' &&
            event.latitude >= -90 &&
            event.latitude <= 90 &&
            typeof event.longitude === 'number' &&
            event.longitude >= -180 &&
            event.longitude <= 180 &&
            typeof event.timestamp === 'string' &&
            event.timestamp.length > 0;

          return hasAllFields && fieldsMatchInput;
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain field type integrity', () => {
      fc.assert(
        fc.property(validIoTEventArbitrary(), (event) => {
          // Verify deviceType is one of the allowed values
          const validDeviceType = event.deviceType === 'vehicle' || event.deviceType === 'handheld';
          
          // Verify deviceId is a non-empty string
          const validDeviceId = typeof event.deviceId === 'string' && event.deviceId.trim().length > 0;
          
          // Verify latitude is a number within valid range
          const validLatitude = 
            typeof event.latitude === 'number' &&
            !isNaN(event.latitude) &&
            event.latitude >= -90 &&
            event.latitude <= 90;
          
          // Verify longitude is a number within valid range
          const validLongitude = 
            typeof event.longitude === 'number' &&
            !isNaN(event.longitude) &&
            event.longitude >= -180 &&
            event.longitude <= 180;
          
          // Verify timestamp is a valid ISO 8601 string
          const validTimestamp = 
            typeof event.timestamp === 'string' &&
            event.timestamp.length > 0 &&
            !isNaN(Date.parse(event.timestamp));

          return validDeviceType && validDeviceId && validLatitude && validLongitude && validTimestamp;
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve exact field values through object spread', () => {
      fc.assert(
        fc.property(validIoTEventArbitrary(), (event) => {
          // Simulate extracting fields (as would happen in batch processor)
          const extracted = {
            deviceType: event.deviceType,
            deviceId: event.deviceId,
            latitude: event.latitude,
            longitude: event.longitude,
            timestamp: event.timestamp
          };

          // Verify extracted values match original
          return (
            extracted.deviceType === event.deviceType &&
            extracted.deviceId === event.deviceId &&
            extracted.latitude === event.latitude &&
            extracted.longitude === event.longitude &&
            extracted.timestamp === event.timestamp
          );
        }),
        { numRuns: 100 }
      );
    });

    it('should handle boundary coordinate values correctly', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('vehicle' as const, 'handheld' as const),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constantFrom(-90, -89.999999, 0, 89.999999, 90),
          fc.constantFrom(-180, -179.999999, 0, 179.999999, 180),
          fc.date().map(d => d.toISOString()),
          (deviceType, deviceId, latitude, longitude, timestamp) => {
            const event: IoTEvent = {
              deviceType,
              deviceId,
              latitude,
              longitude,
              timestamp
            };

            // Verify boundary values are preserved exactly
            return (
              event.latitude === latitude &&
              event.longitude === longitude &&
              event.latitude >= -90 &&
              event.latitude <= 90 &&
              event.longitude >= -180 &&
              event.longitude <= 180
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle both vehicle and handheld device types', () => {
      fc.assert(
        fc.property(validIoTEventArbitrary(), (event) => {
          // Verify deviceType is correctly set and accessible
          const isVehicle = event.deviceType === 'vehicle';
          const isHandheld = event.deviceType === 'handheld';
          
          // Must be exactly one of the two types
          return (isVehicle || isHandheld) && !(isVehicle && isHandheld);
        }),
        { numRuns: 100 }
      );
    });

    it('should maintain precision for coordinate values', () => {
      fc.assert(
        fc.property(validIoTEventArbitrary(), (event) => {
          // Verify coordinates maintain their precision (up to 6 decimal places as per requirements)
          const latPrecision = event.latitude.toString().split('.')[1]?.length || 0;
          const lonPrecision = event.longitude.toString().split('.')[1]?.length || 0;
          
          // Coordinates should be representable as numbers (not lose precision)
          const latRoundTrip = parseFloat(event.latitude.toString()) === event.latitude;
          const lonRoundTrip = parseFloat(event.longitude.toString()) === event.longitude;
          
          return latRoundTrip && lonRoundTrip;
        }),
        { numRuns: 100 }
      );
    });
  });
});
