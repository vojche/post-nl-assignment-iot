/**
 * Vehicle State Analyzer
 * 
 * Analyzes vehicle movement patterns to classify state as MOVING, PARKED, or UNKNOWN.
 * Builds compressed state timeline (stores only state changes) for efficient lookup.
 * 
 * **Validates: Requirements 5.1, 5.2, 8.2**
 */

import { IoTEvent, VehicleState, VehicleStateTimeline } from '../models/types';
import { DistanceCalculator } from '../distance/DistanceCalculator';

/**
 * VehicleStateAnalyzer interface
 */
export interface IVehicleStateAnalyzer {
  /**
   * Build state timeline for all vehicles from their events
   * @param vehicleEvents - Array of vehicle events (sorted by timestamp)
   * @returns Map of vehicleId to VehicleStateTimeline
   */
  buildStateTimeline(vehicleEvents: IoTEvent[]): Map<string, VehicleStateTimeline>;

  /**
   * Get vehicle state at a specific timestamp
   * @param vehicleId - Vehicle ID
   * @param timestamp - ISO 8601 timestamp
   * @returns Vehicle state at that time, or UNKNOWN if no data
   */
  getStateAtTime(vehicleId: string, timestamp: string): VehicleState;
}

/**
 * VehicleStateAnalyzer implementation
 * 
 * State classification rules:
 * - MOVING: Vehicle moved >10m in last 2 minutes (8 events at 15-second intervals)
 * - PARKED: Vehicle moved ≤10m in last 2 minutes
 * - UNKNOWN: No event in last 5 minutes (staleness detection)
 */
export class VehicleStateAnalyzer implements IVehicleStateAnalyzer {
  private distanceCalculator: DistanceCalculator;
  private vehicleTimelines: Map<string, VehicleStateTimeline>;
  
  // Configuration thresholds
  private readonly STATIC_THRESHOLD_METERS: number;
  private readonly STATIC_THRESHOLD_SECONDS: number;
  private readonly STALENESS_THRESHOLD_SECONDS: number;

  constructor(
    distanceCalculator: DistanceCalculator,
    staticThresholdMeters: number = 10,
    staticThresholdSeconds: number = 120,
    stalenessThresholdSeconds: number = 300
  ) {
    this.distanceCalculator = distanceCalculator;
    this.vehicleTimelines = new Map();
    this.STATIC_THRESHOLD_METERS = staticThresholdMeters;
    this.STATIC_THRESHOLD_SECONDS = staticThresholdSeconds;
    this.STALENESS_THRESHOLD_SECONDS = stalenessThresholdSeconds;
  }

  /**
   * Build state timeline for all vehicles
   * Processes events chronologically and stores only state changes
   */
  buildStateTimeline(vehicleEvents: IoTEvent[]): Map<string, VehicleStateTimeline> {
    // Group events by vehicle
    const eventsByVehicle = new Map<string, IoTEvent[]>();
    
    for (const event of vehicleEvents) {
      if (!eventsByVehicle.has(event.deviceId)) {
        eventsByVehicle.set(event.deviceId, []);
      }
      eventsByVehicle.get(event.deviceId)!.push(event);
    }

    // Build timeline for each vehicle
    const timelines = new Map<string, VehicleStateTimeline>();

    for (const [vehicleId, events] of eventsByVehicle) {
      // Sort events by timestamp
      const sortedEvents = events.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const timeline: VehicleStateTimeline = {
        vehicleId,
        states: [],
        lastEventTimestamp: sortedEvents[sortedEvents.length - 1].timestamp,
      };

      // Process each event and detect state changes
      for (let i = 0; i < sortedEvents.length; i++) {
        const currentEvent = sortedEvents[i];
        const state = this.classifyState(sortedEvents, i);

        // Only store state changes (compression)
        const lastState = timeline.states[timeline.states.length - 1];
        if (!lastState || lastState.state !== state) {
          timeline.states.push({
            timestamp: currentEvent.timestamp,
            state,
            latitude: currentEvent.latitude,
            longitude: currentEvent.longitude,
          });
        }
      }

      timelines.set(vehicleId, timeline);
    }

    // Store timelines for getStateAtTime queries
    this.vehicleTimelines = timelines;

    return timelines;
  }

  /**
   * Classify vehicle state based on movement pattern
   * 
   * @param events - All events for this vehicle (sorted by timestamp)
   * @param currentIndex - Index of current event
   * @returns Vehicle state classification
   */
  private classifyState(events: IoTEvent[], currentIndex: number): VehicleState {
    const currentEvent = events[currentIndex];

    // First event: UNKNOWN (no previous data)
    if (currentIndex === 0) {
      return VehicleState.UNKNOWN;
    }

    // Find events within the last 2 minutes (STATIC_THRESHOLD_SECONDS)
    const currentTime = new Date(currentEvent.timestamp).getTime();
    const thresholdTime = currentTime - (this.STATIC_THRESHOLD_SECONDS * 1000);

    // Look back through recent events
    let maxDistance = 0;
    for (let i = currentIndex - 1; i >= 0; i--) {
      const previousEvent = events[i];
      const previousTime = new Date(previousEvent.timestamp).getTime();

      // Stop if event is older than threshold
      if (previousTime < thresholdTime) {
        break;
      }

      // Calculate distance from previous event
      const distance = this.distanceCalculator.calculateDistance(
        { latitude: currentEvent.latitude, longitude: currentEvent.longitude },
        { latitude: previousEvent.latitude, longitude: previousEvent.longitude }
      );

      maxDistance = Math.max(maxDistance, distance);
    }

    // Classify based on maximum distance moved in time window
    if (maxDistance > this.STATIC_THRESHOLD_METERS) {
      return VehicleState.MOVING;
    } else {
      return VehicleState.PARKED;
    }
  }

  /**
   * Get vehicle state at a specific timestamp
   * Uses "most recent before" logic with staleness detection
   */
  getStateAtTime(vehicleId: string, timestamp: string): VehicleState {
    const timeline = this.vehicleTimelines.get(vehicleId);

    if (!timeline) {
      return VehicleState.UNKNOWN;
    }

    const queryTime = new Date(timestamp).getTime();
    const lastEventTime = new Date(timeline.lastEventTimestamp).getTime();

    // Staleness check: If vehicle hasn't reported in 5 minutes, state is UNKNOWN
    if (queryTime - lastEventTime > this.STALENESS_THRESHOLD_SECONDS * 1000) {
      return VehicleState.UNKNOWN;
    }

    // Find most recent state before or at the query time
    let mostRecentState = VehicleState.UNKNOWN;

    for (const stateEntry of timeline.states) {
      const stateTime = new Date(stateEntry.timestamp).getTime();

      if (stateTime <= queryTime) {
        mostRecentState = stateEntry.state;
      } else {
        // States are chronological, so we can stop
        break;
      }
    }

    // Additional staleness check: If most recent state is too old, return UNKNOWN
    const mostRecentStateTime = timeline.states
      .filter(s => new Date(s.timestamp).getTime() <= queryTime)
      .map(s => new Date(s.timestamp).getTime())
      .reduce((max, time) => Math.max(max, time), 0);

    if (queryTime - mostRecentStateTime > this.STALENESS_THRESHOLD_SECONDS * 1000) {
      return VehicleState.UNKNOWN;
    }

    return mostRecentState;
  }

  /**
   * Get vehicle location at a specific timestamp
   * Returns the most recent location before or at the query time
   */
  getLocationAtTime(vehicleId: string, timestamp: string): { latitude: number; longitude: number } | null {
    const timeline = this.vehicleTimelines.get(vehicleId);

    if (!timeline) {
      return null;
    }

    const queryTime = new Date(timestamp).getTime();

    // Find most recent state before or at the query time
    let mostRecentLocation: { latitude: number; longitude: number } | null = null;

    for (const stateEntry of timeline.states) {
      const stateTime = new Date(stateEntry.timestamp).getTime();

      if (stateTime <= queryTime) {
        mostRecentLocation = {
          latitude: stateEntry.latitude,
          longitude: stateEntry.longitude,
        };
      } else {
        break;
      }
    }

    return mostRecentLocation;
  }
}
