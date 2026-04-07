/**
 * Property-based tests for Violation Detection
 * 
 * **Property 12: Proximity Violation Threshold**
 * **Validates: Requirements 5.3, 5.4**
 * 
 * **Property 13: Violation Record Completeness**
 * **Validates: Requirements 6.1, 6.3, 6.4, 6.5**
 * 
 * **Property 19: Distance Calculation Skipped for Moving Vehicles**
 * **Validates: Requirements 8.2**
 */

import * as fc from 'fast-check';
import { ViolationDetector } from '../src/detector/ViolationDetector';
import { DistanceCalculator } from '../src/distance/DistanceCalculator';
import { VehicleStateAnalyzer } from '../src/analyzer/VehicleStateAnalyzer';
import { IoTEvent, VehicleState } from '../src/models/types';

describe('Violation Detection - Property Tests', () => {
  let violationDetector: ViolationDetector;
  let distanceCalculator: DistanceCalculator;
  let vehicleStateAnalyzer: VehicleStateAnalyzer;

  beforeEach(() => {
    distanceCalculator = new DistanceCalculator();
    vehicleStateAnalyzer = new VehicleStateAnalyzer(distanceCalculator);
    violationDetector = new ViolationDetector(distanceCalculator, vehicleStateAnalyzer, 50);
  });

  /**
   * Property 12: Proximity Violation Threshold
   * **Validates: Requirements 5.3, 5.4**
   */
  describe('Property 12: Proximity Violation Threshold', () => {
    it('should record violation only when distance > 50m', () => {
      fc.assert(
        fc.property(
          fc.record({
            latitude: fc.double({ min: -90, max: 90, noNaN: true }),
            longitude: fc.double({ min: -180, max: 180, noNaN: true }),
          }),
          fc.double({ min: 0, max: 200, noNaN: true }), // distance in meters
          fc.double({ min: 0, max: 360, noNaN: true }), // bearing in degrees
          (vehicleCoords, distance, bearing) => {
            // Generate handheld coordinates at specific distance and bearing
            const handheldCoords = moveCoordinates(vehicleCoords, distance, bearing);

            // Create vehicle events (PARKED)
            const vehicleEvents: IoTEvent[] = [
              {
                deviceType: 'vehicle',
                deviceId: 'VV-AA-AA-AA-01',
                latitude: vehicleCoords.latitude,
                longitude: vehicleCoords.longitude,
                timestamp: '2024-01-15T10:00:00Z',
              },
              {
                deviceType: 'vehicle',
                deviceId: 'VV-AA-AA-AA-01',
                latitude: vehicleCoords.latitude,
                longitude: vehicleCoords.longitude,
                timestamp: '2024-01-15T10:02:00Z',
              },
            ];

            // Create handheld event
            const handheldEvents: IoTEvent[] = [
              {
                deviceType: 'handheld',
                deviceId: 'HH-BB-BB-BB-01',
                latitude: handheldCoords.latitude,
                longitude: handheldCoords.longitude,
                timestamp: '2024-01-15T10:02:30Z',
              },
            ];

            const mappings = new Map<string, string>([
              ['HH-BB-BB-BB-01', 'VV-AA-AA-AA-01'],
            ]);

            const vehicleTimeline = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
            const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

            // Calculate actual distance
            const actualDistance = distanceCalculator.calculateDistance(vehicleCoords, handheldCoords);

            // Verify violation is recorded only when distance > 50m
            if (actualDistance > 50) {
              return violations.length === 1;
            } else {
              return violations.length === 0;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 13: Violation Record Completeness
   * **Validates: Requirements 6.1, 6.3, 6.4, 6.5**
   */
  describe('Property 13: Violation Record Completeness', () => {
    it('should include all required fields in violation records', () => {
      fc.assert(
        fc.property(
          fc.record({
            latitude: fc.double({ min: -90, max: 90, noNaN: true }),
            longitude: fc.double({ min: -180, max: 180, noNaN: true }),
          }),
          fc.record({
            latitude: fc.double({ min: -90, max: 90, noNaN: true }),
            longitude: fc.double({ min: -180, max: 180, noNaN: true }),
          }),
          fc.string({ minLength: 5, maxLength: 20 }),
          fc.string({ minLength: 5, maxLength: 20 }),
          (vehicleCoords, handheldCoords, vehicleId, handheldId) => {
            // Ensure distance > 50m
            const distance = distanceCalculator.calculateDistance(vehicleCoords, handheldCoords);
            if (distance <= 50) {
              return true; // Skip this test case
            }

            // Create vehicle events (PARKED)
            const vehicleEvents: IoTEvent[] = [
              {
                deviceType: 'vehicle',
                deviceId: vehicleId,
                latitude: vehicleCoords.latitude,
                longitude: vehicleCoords.longitude,
                timestamp: '2024-01-15T10:00:00Z',
              },
              {
                deviceType: 'vehicle',
                deviceId: vehicleId,
                latitude: vehicleCoords.latitude,
                longitude: vehicleCoords.longitude,
                timestamp: '2024-01-15T10:02:00Z',
              },
            ];

            const handheldEvents: IoTEvent[] = [
              {
                deviceType: 'handheld',
                deviceId: handheldId,
                latitude: handheldCoords.latitude,
                longitude: handheldCoords.longitude,
                timestamp: '2024-01-15T10:02:30Z',
              },
            ];

            const mappings = new Map<string, string>([[handheldId, vehicleId]]);

            const vehicleTimeline = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
            const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

            if (violations.length === 0) {
              return true; // Skip if no violation
            }

            const violation = violations[0];

            // Verify all required fields are present
            return (
              typeof violation.timestamp === 'string' &&
              violation.timestamp.length > 0 &&
              violation.vehicleId === vehicleId &&
              violation.handheldId === handheldId &&
              typeof violation.handheldLatitude === 'number' &&
              typeof violation.handheldLongitude === 'number' &&
              typeof violation.vehicleLatitude === 'number' &&
              typeof violation.vehicleLongitude === 'number' &&
              typeof violation.distance === 'number' &&
              violation.distance > 0 &&
              (violation.vehicleState === VehicleState.PARKED ||
                violation.vehicleState === VehicleState.MOVING ||
                violation.vehicleState === VehicleState.UNKNOWN)
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 19: Distance Calculation Skipped for Moving Vehicles
   * **Validates: Requirements 8.2**
   */
  describe('Property 19: Distance Calculation Skipped for Moving Vehicles', () => {
    it('should not record violations when vehicle is MOVING', () => {
      fc.assert(
        fc.property(
          fc.record({
            latitude: fc.double({ min: -90, max: 90, noNaN: true }),
            longitude: fc.double({ min: -180, max: 180, noNaN: true }),
          }),
          fc.double({ min: 11, max: 100, noNaN: true }), // distance moved (>10m = MOVING)
          fc.double({ min: 0, max: 360, noNaN: true }), // bearing
          (startCoords, distanceMoved, bearing) => {
            // Generate vehicle movement (>10m in 2 minutes = MOVING)
            const endCoords = moveCoordinates(startCoords, distanceMoved, bearing);

            // Create vehicle events (MOVING)
            const vehicleEvents: IoTEvent[] = [
              {
                deviceType: 'vehicle',
                deviceId: 'VV-AA-AA-AA-01',
                latitude: startCoords.latitude,
                longitude: startCoords.longitude,
                timestamp: '2024-01-15T10:00:00Z',
              },
              {
                deviceType: 'vehicle',
                deviceId: 'VV-AA-AA-AA-01',
                latitude: endCoords.latitude,
                longitude: endCoords.longitude,
                timestamp: '2024-01-15T10:01:00Z',
              },
            ];

            // Create handheld event far away (would be violation if vehicle was PARKED)
            const handheldCoords = moveCoordinates(endCoords, 100, 90); // 100m away

            const handheldEvents: IoTEvent[] = [
              {
                deviceType: 'handheld',
                deviceId: 'HH-BB-BB-BB-01',
                latitude: handheldCoords.latitude,
                longitude: handheldCoords.longitude,
                timestamp: '2024-01-15T10:01:30Z',
              },
            ];

            const mappings = new Map<string, string>([
              ['HH-BB-BB-BB-01', 'VV-AA-AA-AA-01'],
            ]);

            const vehicleTimeline = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
            const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

            // No violations should be recorded when vehicle is MOVING
            return violations.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

/**
 * Helper function to move coordinates by distance and bearing
 * Uses simple approximation for small distances
 */
function moveCoordinates(
  coords: { latitude: number; longitude: number },
  distanceMeters: number,
  bearingDegrees: number
): { latitude: number; longitude: number } {
  const earthRadius = 6371000; // meters
  const bearingRad = (bearingDegrees * Math.PI) / 180;
  const latRad = (coords.latitude * Math.PI) / 180;
  const lonRad = (coords.longitude * Math.PI) / 180;
  const angularDistance = distanceMeters / earthRadius;

  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
  );

  const newLonRad =
    lonRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(newLatRad)
    );

  let latitude = (newLatRad * 180) / Math.PI;
  let longitude = (newLonRad * 180) / Math.PI;

  // Clamp to valid ranges to handle floating point precision issues
  latitude = Math.max(-90, Math.min(90, latitude));
  longitude = Math.max(-180, Math.min(180, longitude));

  return { latitude, longitude };
}

