/**
 * Unit tests for ViolationDetector
 * 
 * Tests violation detection with distance > 50m, no violation with distance ≤ 50m,
 * handling missing vehicle location, handling missing vehicle mapping,
 * and optimization: skip calculation for MOVING vehicles.
 */

import { ViolationDetector } from '../src/detector/ViolationDetector';
import { DistanceCalculator } from '../src/distance/DistanceCalculator';
import { VehicleStateAnalyzer } from '../src/analyzer/VehicleStateAnalyzer';
import { IoTEvent, VehicleState, VehicleStateTimeline } from '../src/models/types';

describe('ViolationDetector', () => {
  let violationDetector: ViolationDetector;
  let distanceCalculator: DistanceCalculator;
  let vehicleStateAnalyzer: VehicleStateAnalyzer;

  beforeEach(() => {
    distanceCalculator = new DistanceCalculator();
    vehicleStateAnalyzer = new VehicleStateAnalyzer(distanceCalculator);
    violationDetector = new ViolationDetector(distanceCalculator, vehicleStateAnalyzer, 50);
  });

  describe('detectViolations', () => {
    it('should detect violation when distance > 50m', () => {
      // Setup: Vehicle is PARKED at Amsterdam Central
      const vehicleEvents: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:02:00Z',
        },
      ];

      // Handheld is 75m away
      const handheldEvents: IoTEvent[] = [
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.379800,
          longitude: 4.899500,
          timestamp: '2024-01-15T10:02:30Z',
        },
      ];

      const mappings = new Map<string, string>([
        ['HH-BB-BB-BB-01', 'VV-AA-AA-AA-01'],
      ]);

      // Build vehicle state timeline
      const vehicleTimeline = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);

      // Detect violations
      const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

      expect(violations).toHaveLength(1);
      expect(violations[0].vehicleId).toBe('VV-AA-AA-AA-01');
      expect(violations[0].handheldId).toBe('HH-BB-BB-BB-01');
      expect(violations[0].distance).toBeGreaterThan(50);
      expect(violations[0].vehicleState).toBe(VehicleState.PARKED);
    });

    it('should not detect violation when distance ≤ 50m', () => {
      // Setup: Vehicle is PARKED
      const vehicleEvents: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:02:00Z',
        },
      ];

      // Handheld is 30m away
      const handheldEvents: IoTEvent[] = [
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.379450,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:02:30Z',
        },
      ];

      const mappings = new Map<string, string>([
        ['HH-BB-BB-BB-01', 'VV-AA-AA-AA-01'],
      ]);

      const vehicleTimeline = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
      const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

      expect(violations).toHaveLength(0);
    });

    it('should skip distance calculation for MOVING vehicles', () => {
      // Setup: Vehicle is MOVING (moved >10m in 2 minutes)
      const vehicleEvents: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379300,
          longitude: 4.899600,
          timestamp: '2024-01-15T10:01:00Z',
        },
      ];

      // Handheld is far away (would be violation if vehicle was PARKED)
      const handheldEvents: IoTEvent[] = [
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.380000,
          longitude: 4.900000,
          timestamp: '2024-01-15T10:01:30Z',
        },
      ];

      const mappings = new Map<string, string>([
        ['HH-BB-BB-BB-01', 'VV-AA-AA-AA-01'],
      ]);

      const vehicleTimeline = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
      const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

      // No violation because vehicle is MOVING
      expect(violations).toHaveLength(0);
    });

    it('should handle missing vehicle mapping', () => {
      const handheldEvents: IoTEvent[] = [
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-99',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:00:00Z',
        },
      ];

      const mappings = new Map<string, string>(); // Empty mappings
      const vehicleTimeline = new Map();

      const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

      expect(violations).toHaveLength(0);
    });

    it('should handle missing vehicle location', () => {
      const handheldEvents: IoTEvent[] = [
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:00:00Z',
        },
      ];

      const mappings = new Map<string, string>([
        ['HH-BB-BB-BB-01', 'VV-AA-AA-AA-01'],
      ]);

      // Empty vehicle timeline (no vehicle events)
      const vehicleTimeline = new Map();

      const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

      expect(violations).toHaveLength(0);
    });

    it('should include all required fields in violation record', () => {
      const vehicleEvents: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:02:00Z',
        },
      ];

      const handheldEvents: IoTEvent[] = [
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.379800,
          longitude: 4.899500,
          timestamp: '2024-01-15T10:02:30Z',
        },
      ];

      const mappings = new Map<string, string>([
        ['HH-BB-BB-BB-01', 'VV-AA-AA-AA-01'],
      ]);

      const vehicleTimeline = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
      const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

      expect(violations).toHaveLength(1);
      
      const violation = violations[0];
      expect(violation.timestamp).toBe('2024-01-15T10:02:30Z');
      expect(violation.vehicleId).toBe('VV-AA-AA-AA-01');
      expect(violation.handheldId).toBe('HH-BB-BB-BB-01');
      expect(violation.handheldLatitude).toBe(52.379800);
      expect(violation.handheldLongitude).toBe(4.899500);
      expect(violation.vehicleLatitude).toBe(52.379189);
      expect(violation.vehicleLongitude).toBe(4.899431);
      expect(violation.distance).toBeGreaterThan(0);
      expect(violation.vehicleState).toBe(VehicleState.PARKED);
    });

    it('should detect multiple violations from multiple handheld events', () => {
      const vehicleEvents: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:02:00Z',
        },
      ];

      const handheldEvents: IoTEvent[] = [
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.379800,
          longitude: 4.899500,
          timestamp: '2024-01-15T10:02:30Z',
        },
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.379850,
          longitude: 4.899550,
          timestamp: '2024-01-15T10:03:00Z',
        },
      ];

      const mappings = new Map<string, string>([
        ['HH-BB-BB-BB-01', 'VV-AA-AA-AA-01'],
      ]);

      const vehicleTimeline = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
      const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

      expect(violations.length).toBeGreaterThanOrEqual(2);
    });

    it('should skip handheld event when vehicle state is UNKNOWN', () => {
      // Setup: Vehicle with only one event (will be UNKNOWN state)
      const vehicleEvents: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.379189,
          longitude: 4.899431,
          timestamp: '2024-01-15T10:00:00Z',
        },
      ];

      // Handheld event far in the future (vehicle state will be stale/UNKNOWN)
      const handheldEvents: IoTEvent[] = [
        {
          deviceType: 'handheld',
          deviceId: 'HH-BB-BB-BB-01',
          latitude: 52.379800,
          longitude: 4.899500,
          timestamp: '2024-01-15T10:10:00Z', // 10 minutes later (> 5 min staleness threshold)
        },
      ];

      const mappings = new Map<string, string>([
        ['HH-BB-BB-BB-01', 'VV-AA-AA-AA-01'],
      ]);

      const vehicleTimeline = vehicleStateAnalyzer.buildStateTimeline(vehicleEvents);
      const violations = violationDetector.detectViolations(handheldEvents, vehicleTimeline, mappings);

      // No violation because vehicle state is UNKNOWN (stale data)
      expect(violations).toHaveLength(0);
    });
  });
});

