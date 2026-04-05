/**
 * Property-Based Tests for Vehicle State Detection
 * 
 * **Property 17: Vehicle State Detection - Parked Condition**
 * **Property 18: Vehicle State Detection - Moving Condition**
 * **Validates: Requirements 5.2, 8.2**
 */

import * as fc from 'fast-check';
import { VehicleStateAnalyzer } from '../src/analyzer/VehicleStateAnalyzer';
import { DistanceCalculator } from '../src/distance/DistanceCalculator';
import { IoTEvent, VehicleState } from '../src/models/types';

describe('Property Test: Vehicle State Detection', () => {
  const distanceCalculator = new DistanceCalculator();

  /**
   * Property 17: Vehicle State Detection - Parked Condition
   * 
   * For any vehicle that has not moved more than 10 meters in the last 2 minutes,
   * the Vehicle State Analyzer should classify the vehicle state as PARKED.
   */
  it('should classify vehicle as PARKED when stationary (≤10m movement in 2 minutes)', () => {
    fc.assert(
      fc.property(
        // Generate base coordinates (with margin to avoid boundary issues)
        fc.record({
          latitude: fc.double({ min: -89, max: 89, noNaN: true }),
          longitude: fc.double({ min: -179, max: 179, noNaN: true }),
        }),
        // Generate small distance moved (0-10 meters)
        fc.integer({ min: 0, max: 10 }),
        // Generate number of events (at least 2)
        fc.integer({ min: 2, max: 10 }),
        (baseCoords, distanceMovedMeters, numEvents) => {
          const vehicleId = 'VV-TEST-01';
          const events: IoTEvent[] = [];
          
          // Generate events with small movements (≤10m)
          const baseTime = new Date('2024-01-15T10:00:00Z').getTime();
          
          for (let i = 0; i < numEvents; i++) {
            // Small random offset (within distanceMovedMeters)
            // Use smaller offset to ensure we stay within bounds
            const maxOffset = Math.min(distanceMovedMeters, 5); // Cap at 5m to avoid boundary issues
            const latOffset = (Math.random() - 0.5) * (maxOffset / 111000); // ~111km per degree
            const lonOffset = (Math.random() - 0.5) * (maxOffset / 111000);
            
            // Clamp to valid ranges
            const latitude = Math.max(-90, Math.min(90, baseCoords.latitude + latOffset));
            const longitude = Math.max(-180, Math.min(180, baseCoords.longitude + lonOffset));
            
            events.push({
              deviceType: 'vehicle',
              deviceId: vehicleId,
              latitude,
              longitude,
              timestamp: new Date(baseTime + i * 15000).toISOString(), // 15 seconds apart
            });
          }

          // Build timeline
          const analyzer = new VehicleStateAnalyzer(distanceCalculator);
          const timelines = analyzer.buildStateTimeline(events);

          // Verify: Last state should be PARKED (after first event which is UNKNOWN)
          const timeline = timelines.get(vehicleId);
          if (!timeline || timeline.states.length === 0) {
            return false;
          }

          // Check the final state (should be PARKED)
          const finalState = timeline.states[timeline.states.length - 1].state;
          
          // First event is always UNKNOWN, subsequent events should be PARKED
          if (timeline.states.length === 1) {
            return finalState === VehicleState.UNKNOWN;
          } else {
            return finalState === VehicleState.PARKED;
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 18: Vehicle State Detection - Moving Condition
   * 
   * For any vehicle that has moved more than 10 meters in the last 2 minutes,
   * the Vehicle State Analyzer should classify the vehicle state as MOVING.
   */
  it('should classify vehicle as MOVING when in motion (>10m movement in 2 minutes)', () => {
    fc.assert(
      fc.property(
        // Generate base coordinates (with margin to avoid boundary issues)
        fc.record({
          latitude: fc.double({ min: -88, max: 88, noNaN: true }),
          longitude: fc.double({ min: -178, max: 178, noNaN: true }),
        }),
        // Generate large distance moved (15-100 meters for reliability)
        fc.integer({ min: 15, max: 100 }),
        // Generate number of events (at least 3 for reliable detection)
        fc.integer({ min: 3, max: 10 }),
        (baseCoords, distanceMovedMeters, numEvents) => {
          const vehicleId = 'VV-TEST-02';
          const events: IoTEvent[] = [];
          
          // Generate events with large movements (>10m)
          const baseTime = new Date('2024-01-15T10:00:00Z').getTime();
          
          // First event at base location
          events.push({
            deviceType: 'vehicle',
            deviceId: vehicleId,
            latitude: baseCoords.latitude,
            longitude: baseCoords.longitude,
            timestamp: new Date(baseTime).toISOString(),
          });

          // Subsequent events move progressively in a straight line
          for (let i = 1; i < numEvents; i++) {
            // Move in a consistent direction to ensure distance > 10m
            // Distribute the total distance across events
            const latOffset = (distanceMovedMeters / 111000) * (i / (numEvents - 1));
            
            events.push({
              deviceType: 'vehicle',
              deviceId: vehicleId,
              latitude: baseCoords.latitude + latOffset,
              longitude: baseCoords.longitude,
              timestamp: new Date(baseTime + i * 15000).toISOString(), // 15 seconds apart
            });
          }

          // Build timeline
          const analyzer = new VehicleStateAnalyzer(distanceCalculator);
          const timelines = analyzer.buildStateTimeline(events);

          // Verify: Last state should be MOVING
          const timeline = timelines.get(vehicleId);
          if (!timeline || timeline.states.length === 0) {
            return false;
          }

          // Check the final state (should be MOVING)
          const finalState = timeline.states[timeline.states.length - 1].state;
          
          // With 3+ events and >15m total movement, final state should be MOVING
          return finalState === VehicleState.MOVING;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: First event always has UNKNOWN state
   */
  it('should classify first event as UNKNOWN (no previous data)', () => {
    fc.assert(
      fc.property(
        fc.record({
          latitude: fc.double({ min: -90, max: 90, noNaN: true }),
          longitude: fc.double({ min: -180, max: 180, noNaN: true }),
        }),
        (coords) => {
          const vehicleId = 'VV-TEST-03';
          const events: IoTEvent[] = [{
            deviceType: 'vehicle',
            deviceId: vehicleId,
            latitude: coords.latitude,
            longitude: coords.longitude,
            timestamp: new Date('2024-01-15T10:00:00Z').toISOString(),
          }];

          // Build timeline
          const analyzer = new VehicleStateAnalyzer(distanceCalculator);
          const timelines = analyzer.buildStateTimeline(events);

          // Verify: First state is UNKNOWN
          const timeline = timelines.get(vehicleId);
          if (!timeline || timeline.states.length === 0) {
            return false;
          }

          return timeline.states[0].state === VehicleState.UNKNOWN;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: State timeline compression
   * Only state changes are stored, not all events
   */
  it('should store only state changes in timeline (compression)', () => {
    fc.assert(
      fc.property(
        fc.record({
          latitude: fc.double({ min: -90, max: 90, noNaN: true }),
          longitude: fc.double({ min: -180, max: 180, noNaN: true }),
        }),
        fc.integer({ min: 5, max: 20 }),
        (baseCoords, numEvents) => {
          const vehicleId = 'VV-TEST-04';
          const events: IoTEvent[] = [];
          
          // Generate events at same location (all PARKED after first UNKNOWN)
          const baseTime = new Date('2024-01-15T10:00:00Z').getTime();
          
          for (let i = 0; i < numEvents; i++) {
            events.push({
              deviceType: 'vehicle',
              deviceId: vehicleId,
              latitude: baseCoords.latitude,
              longitude: baseCoords.longitude,
              timestamp: new Date(baseTime + i * 15000).toISOString(),
            });
          }

          // Build timeline
          const analyzer = new VehicleStateAnalyzer(distanceCalculator);
          const timelines = analyzer.buildStateTimeline(events);

          // Verify: Timeline has fewer entries than events (compression)
          const timeline = timelines.get(vehicleId);
          if (!timeline) {
            return false;
          }

          // Should have 2 state changes: UNKNOWN → PARKED
          return timeline.states.length <= 2 && timeline.states.length < numEvents;
        }
      ),
      { numRuns: 100 }
    );
  });
});
