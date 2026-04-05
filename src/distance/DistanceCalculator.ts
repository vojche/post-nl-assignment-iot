/**
 * Distance Calculator using Haversine Formula
 * 
 * Calculates great-circle distance between two coordinate pairs on Earth's surface.
 * Accuracy within 0.5% for distances under 100 meters.
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
 */

import { Coordinates } from '../models/types';

/**
 * Earth's radius in meters
 * Used in Haversine formula for distance calculation
 */
const EARTH_RADIUS_METERS = 6371000;

/**
 * DistanceCalculator class
 * 
 * Provides geographic distance calculation between two coordinate pairs
 * using the Haversine formula.
 */
export class DistanceCalculator {
  /**
   * Calculate distance between two coordinate pairs using Haversine formula
   * 
   * Formula:
   * a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlon/2)
   * c = 2 × atan2(√a, √(1−a))
   * distance = R × c
   * 
   * Where R = 6371000 meters (Earth's radius)
   * 
   * @param point1 - First coordinate pair
   * @param point2 - Second coordinate pair
   * @returns Distance in meters, rounded to 1 decimal place
   * @throws Error if coordinates are invalid
   */
  calculateDistance(point1: Coordinates, point2: Coordinates): number {
    // Validate coordinates
    this.validateCoordinates(point1);
    this.validateCoordinates(point2);

    // Convert degrees to radians
    const lat1Rad = this.toRadians(point1.latitude);
    const lat2Rad = this.toRadians(point2.latitude);
    const deltaLatRad = this.toRadians(point2.latitude - point1.latitude);
    const deltaLonRad = this.toRadians(point2.longitude - point1.longitude);

    // Haversine formula
    const a = 
      Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) *
      Math.sin(deltaLonRad / 2) * Math.sin(deltaLonRad / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    const distance = EARTH_RADIUS_METERS * c;

    // Return distance rounded to 1 decimal place
    return Math.round(distance * 10) / 10;
  }

  /**
   * Validate coordinate pair
   * 
   * @param coords - Coordinate pair to validate
   * @throws Error if latitude is outside [-90, 90] or longitude is outside [-180, 180]
   */
  private validateCoordinates(coords: Coordinates): void {
    if (coords.latitude < -90 || coords.latitude > 90) {
      throw new Error(
        `Invalid latitude: ${coords.latitude}. Must be between -90 and 90 degrees.`
      );
    }

    if (coords.longitude < -180 || coords.longitude > 180) {
      throw new Error(
        `Invalid longitude: ${coords.longitude}. Must be between -180 and 180 degrees.`
      );
    }
  }

  /**
   * Convert degrees to radians
   * 
   * @param degrees - Angle in degrees
   * @returns Angle in radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}
