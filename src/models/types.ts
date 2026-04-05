/**
 * Data models for IoT Proximity Alert System
 * 
 * These interfaces define the core data structures used throughout the system
 * for processing GPS events, tracking vehicle states, detecting proximity violations,
 * and generating daily reports.
 */

/**
 * IoT Event from GPS devices (vehicles and handhelds)
 * Stored in S3 via Kinesis Firehose, partitioned by date
 */
export interface IoTEvent {
  deviceType: 'vehicle' | 'handheld';
  deviceId: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

/**
 * Geographic coordinates
 */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Vehicle state classification based on movement patterns
 */
export enum VehicleState {
  MOVING = 'MOVING',
  PARKED = 'PARKED',
  UNKNOWN = 'UNKNOWN'
}

/**
 * Vehicle state timeline (in-memory only)
 * Stores only state changes to reduce memory usage
 */
export interface VehicleStateTimeline {
  vehicleId: string;
  states: Array<{
    timestamp: string;
    state: VehicleState;
    latitude: number;
    longitude: number;
  }>;
  lastEventTimestamp: string; // For staleness detection
}

/**
 * Proximity violation record
 * Created when handheld device is >50m from paired vehicle while vehicle is parked
 */
export interface ProximityViolation {
  timestamp: string;
  vehicleId: string;
  handheldId: string;
  handheldLatitude: number;
  handheldLongitude: number;
  vehicleLatitude: number;
  vehicleLongitude: number;
  distance: number; // In meters
  vehicleState: VehicleState;
}

/**
 * Daily report metadata
 */
export interface ReportMetadata {
  processingDuration: number; // Milliseconds
  eventsProcessed: number;
  eventsSkipped: number; // Vehicle MOVING, skipped distance calc
  devicesWithNoData: {
    vehicles: string[]; // Vehicle IDs with no events
    handhelds: string[]; // Handheld IDs with no events
  };
}

/**
 * Daily report published to SNS and stored in S3
 * Contains all proximity violations for a given day
 */
export interface DailyReport {
  reportDate: string; // YYYY-MM-DD
  generatedAt: string; // ISO 8601 timestamp
  summary: {
    totalEvents: number;
    totalVehicles: number;
    totalHandhelds: number;
    totalViolations: number;
    violationRate: number; // Percentage
  };
  violations: ProximityViolation[];
  metadata: ReportMetadata;
}
