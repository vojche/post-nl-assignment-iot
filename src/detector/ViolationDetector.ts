/**
 * Violation Detector
 * 
 * Detects proximity violations between handheld devices and their paired vehicles.
 * Skips distance calculation when vehicle is MOVING (optimization).
 * 
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.3, 6.4, 6.5**
 */

import { IoTEvent, ProximityViolation, VehicleState, VehicleStateTimeline } from '../models/types';
import { DistanceCalculator } from '../distance/DistanceCalculator';
import { VehicleStateAnalyzer } from '../analyzer/VehicleStateAnalyzer';

/**
 * ViolationDetector interface
 */
export interface IViolationDetector {
  /**
   * Detect proximity violations for handheld events
   * @param handheldEvents - Array of handheld events
   * @param vehicleStateTimeline - Map of vehicle state timelines
   * @param mappings - Map of handheldId to vehicleId
   * @returns Array of proximity violations
   */
  detectViolations(
    handheldEvents: IoTEvent[],
    vehicleStateTimeline: Map<string, VehicleStateTimeline>,
    mappings: Map<string, string>
  ): ProximityViolation[];
}

/**
 * ViolationDetector implementation
 * 
 * For each handheld event:
 * 1. Get paired vehicle ID from mappings (handheldId → vehicleId)
 * 2. Get vehicle state at event timestamp
 * 3. Skip distance calculation if vehicle is MOVING (optimization)
 * 4. Calculate distance if vehicle is PARKED
 * 5. Record violation if distance > 50 meters
 */
export class ViolationDetector implements IViolationDetector {
  private distanceCalculator: DistanceCalculator;
  private vehicleStateAnalyzer: VehicleStateAnalyzer;
  private readonly DISTANCE_THRESHOLD_METERS: number;

  constructor(
    distanceCalculator: DistanceCalculator,
    vehicleStateAnalyzer: VehicleStateAnalyzer,
    distanceThresholdMeters: number = 50
  ) {
    this.distanceCalculator = distanceCalculator;
    this.vehicleStateAnalyzer = vehicleStateAnalyzer;
    this.DISTANCE_THRESHOLD_METERS = distanceThresholdMeters;
  }

  /**
   * Detect proximity violations
   */
  detectViolations(
    handheldEvents: IoTEvent[],
    vehicleStateTimeline: Map<string, VehicleStateTimeline>,
    mappings: Map<string, string>
  ): ProximityViolation[] {
    const violations: ProximityViolation[] = [];

    for (const handheldEvent of handheldEvents) {
      // Get paired vehicle ID from mappings (handheldId → vehicleId, O(1) lookup)
      const vehicleId = mappings.get(handheldEvent.deviceId);

      if (!vehicleId) {
        console.warn(`[ViolationDetector] No vehicle mapping found for handheld ${handheldEvent.deviceId}`);
        continue;
      }

      // Get vehicle state at event timestamp
      const vehicleState = this.vehicleStateAnalyzer.getStateAtTime(vehicleId, handheldEvent.timestamp);

      // Skip distance calculation if vehicle is MOVING (optimization)
      if (vehicleState === VehicleState.MOVING) {
        continue;
      }

      // Skip if vehicle state is UNKNOWN (no recent data)
      if (vehicleState === VehicleState.UNKNOWN) {
        console.warn(`[ViolationDetector] Vehicle ${vehicleId} state is UNKNOWN at ${handheldEvent.timestamp}`);
        continue;
      }

      // Get vehicle location at event timestamp
      const vehicleLocation = this.vehicleStateAnalyzer.getLocationAtTime(vehicleId, handheldEvent.timestamp);

      if (!vehicleLocation) {
        console.warn(`[ViolationDetector] No vehicle location found for ${vehicleId} at ${handheldEvent.timestamp}`);
        continue;
      }

      // Calculate distance between handheld and vehicle
      const distance = this.distanceCalculator.calculateDistance(
        { latitude: handheldEvent.latitude, longitude: handheldEvent.longitude },
        { latitude: vehicleLocation.latitude, longitude: vehicleLocation.longitude }
      );

      // Record violation if distance > threshold
      if (distance > this.DISTANCE_THRESHOLD_METERS) {
        violations.push({
          timestamp: handheldEvent.timestamp,
          vehicleId,
          handheldId: handheldEvent.deviceId,
          handheldLatitude: handheldEvent.latitude,
          handheldLongitude: handheldEvent.longitude,
          vehicleLatitude: vehicleLocation.latitude,
          vehicleLongitude: vehicleLocation.longitude,
          distance,
          vehicleState,
        });
      }
    }

    console.log(`[ViolationDetector] Detected ${violations.length} proximity violations`);
    return violations;
  }
}
