/**
 * Unit Tests for VehicleStateAnalyzer
 * 
 * Tests state classification, timeline building, and state queries.
 * 
 * **Validates: Requirements 5.1, 5.2**
 */

import { VehicleStateAnalyzer } from '../src/analyzer/VehicleStateAnalyzer';
import { DistanceCalculator } from '../src/distance/DistanceCalculator';
import { IoTEvent, VehicleState } from '../src/models/types';

describe('VehicleStateAnalyzer', () => {
  const distanceCalculator = new DistanceCalculator();

  describe('buildStateTimeline', () => {
    it('should classify vehicle as PARKED when stationary', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:15Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:30Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      const timelines = analyzer.buildStateTimeline(events);

      const timeline = timelines.get('VV-AA-AA-AA-01');
      expect(timeline).toBeDefined();
      expect(timeline!.states.length).toBeGreaterThan(0);
      
      // Last state should be PARKED
      const lastState = timeline!.states[timeline!.states.length - 1];
      expect(lastState.state).toBe(VehicleState.PARKED);
    });

    it('should classify vehicle as MOVING when in motion', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-02',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-02',
          latitude: 52.370300, // Moved ~9.3m north
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:15Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-02',
          latitude: 52.370400, // Moved another ~11.1m north (total >10m from previous)
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:30Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      const timelines = analyzer.buildStateTimeline(events);

      const timeline = timelines.get('VV-AA-AA-AA-02');
      expect(timeline).toBeDefined();
      
      // Last state should be MOVING
      const lastState = timeline!.states[timeline!.states.length - 1];
      expect(lastState.state).toBe(VehicleState.MOVING);
    });

    it('should classify first event as UNKNOWN', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-03',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      const timelines = analyzer.buildStateTimeline(events);

      const timeline = timelines.get('VV-AA-AA-AA-03');
      expect(timeline).toBeDefined();
      expect(timeline!.states.length).toBe(1);
      expect(timeline!.states[0].state).toBe(VehicleState.UNKNOWN);
    });

    it('should handle multiple vehicles', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-02',
          latitude: 52.380000,
          longitude: 4.900000,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-01',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:15Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-02',
          latitude: 52.380100,
          longitude: 4.900000,
          timestamp: '2024-01-15T10:00:15Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      const timelines = analyzer.buildStateTimeline(events);

      expect(timelines.size).toBe(2);
      expect(timelines.has('VV-AA-AA-AA-01')).toBe(true);
      expect(timelines.has('VV-AA-AA-AA-02')).toBe(true);
    });

    it('should compress timeline by storing only state changes', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-04',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-04',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:15Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-04',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:30Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-04',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:45Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      const timelines = analyzer.buildStateTimeline(events);

      const timeline = timelines.get('VV-AA-AA-AA-04');
      expect(timeline).toBeDefined();
      
      // Should have 2 state changes: UNKNOWN → PARKED
      expect(timeline!.states.length).toBeLessThanOrEqual(2);
      expect(timeline!.states.length).toBeLessThan(events.length);
    });

    it('should handle rapid state changes', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-05',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-05',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:15Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-05',
          latitude: 52.370400, // Move (MOVING)
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:30Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-05',
          latitude: 52.370400, // Stop (PARKED)
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:45Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-05',
          latitude: 52.370400,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:01:00Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      const timelines = analyzer.buildStateTimeline(events);

      const timeline = timelines.get('VV-AA-AA-AA-05');
      expect(timeline).toBeDefined();
      
      // Should have multiple state changes
      expect(timeline!.states.length).toBeGreaterThan(1);
    });
  });

  describe('getStateAtTime', () => {
    it('should return correct state at specific timestamp', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-06',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-06',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:15Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-06',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:30Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      analyzer.buildStateTimeline(events);

      // Query state at 10:00:20 (between events)
      const state = analyzer.getStateAtTime('VV-AA-AA-AA-06', '2024-01-15T10:00:20Z');
      
      // Should be PARKED (most recent state before query time)
      expect(state).toBe(VehicleState.PARKED);
    });

    it('should return UNKNOWN for non-existent vehicle', () => {
      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      analyzer.buildStateTimeline([]);

      const state = analyzer.getStateAtTime('VV-NONEXISTENT', '2024-01-15T10:00:00Z');
      expect(state).toBe(VehicleState.UNKNOWN);
    });

    it('should return UNKNOWN for stale data (>5 minutes old)', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-07',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-07',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:15Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      analyzer.buildStateTimeline(events);

      // Query state 6 minutes later (stale)
      const state = analyzer.getStateAtTime('VV-AA-AA-AA-07', '2024-01-15T10:06:00Z');
      expect(state).toBe(VehicleState.UNKNOWN);
    });

    it('should return state when querying at exact event time', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-12',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-12',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:15Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      analyzer.buildStateTimeline(events);

      // Query state at exact event time
      const state = analyzer.getStateAtTime('VV-AA-AA-AA-12', '2024-01-15T10:00:15Z');
      expect(state).toBe(VehicleState.PARKED);
    });
  });

  describe('getLocationAtTime', () => {
    it('should return correct location at specific timestamp', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-08',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-08',
          latitude: 52.370300,
          longitude: 4.895200,
          timestamp: '2024-01-15T10:00:15Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      analyzer.buildStateTimeline(events);

      // Query location at 10:00:10 (between events)
      const location = analyzer.getLocationAtTime('VV-AA-AA-AA-08', '2024-01-15T10:00:10Z');
      
      expect(location).not.toBeNull();
      expect(location!.latitude).toBe(52.370216);
      expect(location!.longitude).toBe(4.895168);
    });

    it('should return null for non-existent vehicle', () => {
      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      analyzer.buildStateTimeline([]);

      const location = analyzer.getLocationAtTime('VV-NONEXISTENT', '2024-01-15T10:00:00Z');
      expect(location).toBeNull();
    });

    it('should return null when querying before any events', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-10',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      analyzer.buildStateTimeline(events);

      // Query location before first event
      const location = analyzer.getLocationAtTime('VV-AA-AA-AA-10', '2024-01-15T09:59:00Z');
      expect(location).toBeNull();
    });

    it('should return most recent location when querying after all events', () => {
      const events: IoTEvent[] = [
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-11',
          latitude: 52.370216,
          longitude: 4.895168,
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          deviceType: 'vehicle',
          deviceId: 'VV-AA-AA-AA-11',
          latitude: 52.370300,
          longitude: 4.895200,
          timestamp: '2024-01-15T10:01:00Z',
        },
      ];

      const analyzer = new VehicleStateAnalyzer(distanceCalculator);
      analyzer.buildStateTimeline(events);

      // Query location after all events
      const location = analyzer.getLocationAtTime('VV-AA-AA-AA-11', '2024-01-15T10:10:00Z');
      
      // Should return last known location
      expect(location).not.toBeNull();
      expect(location!.latitude).toBe(52.370300);
      expect(location!.longitude).toBe(4.895200);
    });
  });
});
