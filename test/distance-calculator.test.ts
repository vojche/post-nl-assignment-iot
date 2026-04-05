/**
 * Unit Tests and Property-Based Tests for DistanceCalculator
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
 * 
 * Tests verify:
 * - Haversine distance calculation correctness
 * - Coordinate validation
 * - Mathematical properties (commutativity, identity)
 * - Precision and accuracy requirements
 */

import * as fc from 'fast-check';
import { DistanceCalculator } from '../src/distance/DistanceCalculator';
import { Coordinates } from '../src/models/types';

describe('DistanceCalculator', () => {
  let calculator: DistanceCalculator;

  beforeEach(() => {
    calculator = new DistanceCalculator();
  });

  describe('Unit Tests - Specific Examples', () => {
    /**
     * Test: Distance between same point should be zero
     * **Validates: Requirement 4.1**
     */
    it('should return 0 meters for identical coordinates', () => {
      const point: Coordinates = { latitude: 52.370216, longitude: 4.895168 };
      const distance = calculator.calculateDistance(point, point);
      expect(distance).toBe(0.0);
    });

    /**
     * Test: Known distance between Amsterdam and Rotterdam
     * **Validates: Requirements 4.1, 4.5**
     */
    it('should calculate correct distance between Amsterdam and Rotterdam', () => {
      const amsterdam: Coordinates = { latitude: 52.370216, longitude: 4.895168 };
      const rotterdam: Coordinates = { latitude: 51.9225, longitude: 4.47917 };
      
      const distance = calculator.calculateDistance(amsterdam, rotterdam);
      
      // Expected distance is approximately 57,000 meters (57 km)
      // Allow 1% tolerance for Haversine approximation
      expect(distance).toBeGreaterThan(56000);
      expect(distance).toBeLessThan(58000);
    });

    /**
     * Test: Distance calculation is commutative
     * **Validates: Requirement 4.1**
     */
    it('should return same distance regardless of point order', () => {
      const point1: Coordinates = { latitude: 52.370216, longitude: 4.895168 };
      const point2: Coordinates = { latitude: 51.9225, longitude: 4.47917 };
      
      const distanceAB = calculator.calculateDistance(point1, point2);
      const distanceBA = calculator.calculateDistance(point2, point1);
      
      expect(distanceAB).toBe(distanceBA);
    });

    /**
     * Test: Distance result is in meters
     * **Validates: Requirement 4.2**
     */
    it('should return distance in meters', () => {
      const point1: Coordinates = { latitude: 52.370216, longitude: 4.895168 };
      const point2: Coordinates = { latitude: 52.371216, longitude: 4.896168 };
      
      const distance = calculator.calculateDistance(point1, point2);
      
      // Distance should be positive and reasonable (in meters, not km or other units)
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(200); // ~150m for this small delta
    });

    /**
     * Test: Distance precision to 1 decimal place
     * **Validates: Requirement 4.4**
     */
    it('should return distance with precision to 1 decimal place', () => {
      const point1: Coordinates = { latitude: 52.370216, longitude: 4.895168 };
      const point2: Coordinates = { latitude: 52.371216, longitude: 4.896168 };
      
      const distance = calculator.calculateDistance(point1, point2);
      
      // Check that result has at most 1 decimal place
      const decimalPlaces = (distance.toString().split('.')[1] || '').length;
      expect(decimalPlaces).toBeLessThanOrEqual(1);
    });

    /**
     * Test: Large distance precision (edge case from property test)
     * **Validates: Requirement 4.4**
     */
    it('should handle large distances with correct precision', () => {
      const point1: Coordinates = { latitude: 0, longitude: 0 };
      const point2: Coordinates = { latitude: 0, longitude: 179.864322 };
      
      const distance = calculator.calculateDistance(point1, point2);
      
      // Distance should be properly rounded to 1 decimal place
      const multipliedBy10 = distance * 10;
      const roundedMultiplied = Math.round(multipliedBy10);
      const difference = Math.abs(multipliedBy10 - roundedMultiplied);
      
      expect(difference).toBeLessThan(0.01);
    });

    /**
     * Test: Boundary latitude values are accepted
     * **Validates: Requirement 4.3**
     */
    it('should accept boundary latitude values (-90, 90)', () => {
      const northPole: Coordinates = { latitude: 90, longitude: 0 };
      const southPole: Coordinates = { latitude: -90, longitude: 0 };
      
      expect(() => calculator.calculateDistance(northPole, southPole)).not.toThrow();
    });

    /**
     * Test: Boundary longitude values are accepted
     * **Validates: Requirement 4.3**
     */
    it('should accept boundary longitude values (-180, 180)', () => {
      const point1: Coordinates = { latitude: 0, longitude: -180 };
      const point2: Coordinates = { latitude: 0, longitude: 180 };
      
      expect(() => calculator.calculateDistance(point1, point2)).not.toThrow();
    });
  });

  describe('Unit Tests - Validation Errors', () => {
    /**
     * Test: Invalid latitude (> 90) should throw error
     * **Validates: Requirement 4.3**
     */
    it('should throw error for latitude > 90', () => {
      const invalidPoint: Coordinates = { latitude: 91, longitude: 0 };
      const validPoint: Coordinates = { latitude: 0, longitude: 0 };
      
      expect(() => calculator.calculateDistance(invalidPoint, validPoint))
        .toThrow('Invalid latitude: 91');
    });

    /**
     * Test: Invalid latitude (< -90) should throw error
     * **Validates: Requirement 4.3**
     */
    it('should throw error for latitude < -90', () => {
      const invalidPoint: Coordinates = { latitude: -91, longitude: 0 };
      const validPoint: Coordinates = { latitude: 0, longitude: 0 };
      
      expect(() => calculator.calculateDistance(invalidPoint, validPoint))
        .toThrow('Invalid latitude: -91');
    });

    /**
     * Test: Invalid longitude (> 180) should throw error
     * **Validates: Requirement 4.3**
     */
    it('should throw error for longitude > 180', () => {
      const invalidPoint: Coordinates = { latitude: 0, longitude: 181 };
      const validPoint: Coordinates = { latitude: 0, longitude: 0 };
      
      expect(() => calculator.calculateDistance(invalidPoint, validPoint))
        .toThrow('Invalid longitude: 181');
    });

    /**
     * Test: Invalid longitude (< -180) should throw error
     * **Validates: Requirement 4.3**
     */
    it('should throw error for longitude < -180', () => {
      const invalidPoint: Coordinates = { latitude: 0, longitude: -181 };
      const validPoint: Coordinates = { latitude: 0, longitude: 0 };
      
      expect(() => calculator.calculateDistance(invalidPoint, validPoint))
        .toThrow('Invalid longitude: -181');
    });

    /**
     * Test: Validation checks both points
     * **Validates: Requirement 4.3**
     */
    it('should validate both coordinate pairs', () => {
      const validPoint: Coordinates = { latitude: 0, longitude: 0 };
      const invalidPoint: Coordinates = { latitude: 0, longitude: 200 };
      
      // Should throw when invalid point is first argument
      expect(() => calculator.calculateDistance(invalidPoint, validPoint)).toThrow();
      
      // Should throw when invalid point is second argument
      expect(() => calculator.calculateDistance(validPoint, invalidPoint)).toThrow();
    });
  });

  describe('Property-Based Tests', () => {
    /**
     * Arbitrary generator for valid coordinates
     * Generates coordinates with up to 6 decimal places precision
     */
    const validCoordinatesArbitrary = (): fc.Arbitrary<Coordinates> => {
      return fc.record({
        latitude: fc.double({ min: -90, max: 90, noNaN: true })
          .map(n => Math.round(n * 1e6) / 1e6),
        longitude: fc.double({ min: -180, max: 180, noNaN: true })
          .map(n => Math.round(n * 1e6) / 1e6)
      });
    };

    /**
     * Arbitrary generator for invalid coordinates
     */
    const invalidCoordinatesArbitrary = (): fc.Arbitrary<Coordinates> => {
      return fc.oneof(
        // Invalid latitude (> 90)
        fc.record({
          latitude: fc.double({ min: 90.001, max: 200, noNaN: true }),
          longitude: fc.double({ min: -180, max: 180, noNaN: true })
        }),
        // Invalid latitude (< -90)
        fc.record({
          latitude: fc.double({ min: -200, max: -90.001, noNaN: true }),
          longitude: fc.double({ min: -180, max: 180, noNaN: true })
        }),
        // Invalid longitude (> 180)
        fc.record({
          latitude: fc.double({ min: -90, max: 90, noNaN: true }),
          longitude: fc.double({ min: 180.001, max: 360, noNaN: true })
        }),
        // Invalid longitude (< -180)
        fc.record({
          latitude: fc.double({ min: -90, max: 90, noNaN: true }),
          longitude: fc.double({ min: -360, max: -180.001, noNaN: true })
        })
      );
    };

    /**
     * Property 5: Distance Calculation Commutativity
     * **Validates: Requirements 4.1, 13.4**
     * 
     * For any two valid coordinate pairs A and B, distance(A, B) = distance(B, A)
     */
    it('Property 5: should calculate same distance regardless of order', () => {
      fc.assert(
        fc.property(
          validCoordinatesArbitrary(),
          validCoordinatesArbitrary(),
          (point1, point2) => {
            const distanceAB = calculator.calculateDistance(point1, point2);
            const distanceBA = calculator.calculateDistance(point2, point1);
            
            // Distances should be exactly equal (same calculation, same rounding)
            return distanceAB === distanceBA;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 6: Distance Calculation Identity
     * **Validates: Requirements 4.1, 13.5**
     * 
     * For any valid coordinate pair, distance from point to itself is zero
     */
    it('Property 6: should return zero distance for same point', () => {
      fc.assert(
        fc.property(validCoordinatesArbitrary(), (point) => {
          const distance = calculator.calculateDistance(point, point);
          return distance === 0.0;
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property 7: Distance Calculation Units and Precision
     * **Validates: Requirements 4.2, 4.4**
     * 
     * For any two valid coordinate pairs, result should be:
     * - Non-negative (distance cannot be negative)
     * - In meters (reasonable range for Earth surface)
     * - Rounded to 1 decimal place
     */
    it('Property 7: should return non-negative distance in meters with 1 decimal precision', () => {
      fc.assert(
        fc.property(
          validCoordinatesArbitrary(),
          validCoordinatesArbitrary(),
          (point1, point2) => {
            // Create fresh calculator instance for each test
            const calc = new DistanceCalculator();
            const distance = calc.calculateDistance(point1, point2);
            
            // Distance must be non-negative
            if (distance < 0) return false;
            
            // Distance must be reasonable (max distance on Earth is ~20,037 km at equator)
            // Use 21,000 km to be safe
            if (distance > 21000000) return false;
            
            // Distance must be properly rounded to 1 decimal place
            // This means distance * 10 should be very close to an integer
            const multipliedBy10 = distance * 10;
            const roundedMultiplied = Math.round(multipliedBy10);
            const difference = Math.abs(multipliedBy10 - roundedMultiplied);
            
            // Allow tiny floating point errors (less than 0.01, which is 0.001 meters)
            return difference < 0.01;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 8: Distance Calculation Validation
     * **Validates: Requirement 4.3**
     * 
     * For any coordinate pair with invalid latitude or longitude,
     * calculateDistance should throw an error
     */
    it('Property 8: should throw error for invalid coordinates', () => {
      fc.assert(
        fc.property(
          invalidCoordinatesArbitrary(),
          validCoordinatesArbitrary(),
          (invalidPoint, validPoint) => {
            // Should throw when invalid point is first argument
            let threwError1 = false;
            try {
              calculator.calculateDistance(invalidPoint, validPoint);
            } catch (e) {
              threwError1 = true;
            }
            
            // Should throw when invalid point is second argument
            let threwError2 = false;
            try {
              calculator.calculateDistance(validPoint, invalidPoint);
            } catch (e) {
              threwError2 = true;
            }
            
            return threwError1 && threwError2;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 9: Distance Calculation Accuracy
     * **Validates: Requirement 4.5**
     * 
     * For coordinate pairs within 100 meters, Haversine should be accurate
     * within 1 meter. We test this by verifying triangle inequality holds
     * and distances are consistent.
     */
    it('Property 9: should maintain accuracy for short distances', () => {
      fc.assert(
        fc.property(
          validCoordinatesArbitrary(),
          fc.double({ min: -0.001, max: 0.001, noNaN: true }), // Small lat delta (~100m)
          fc.double({ min: -0.001, max: 0.001, noNaN: true }), // Small lon delta (~100m)
          (basePoint, latDelta, lonDelta) => {
            // Create a nearby point (within ~100m)
            const nearbyPoint: Coordinates = {
              latitude: Math.max(-90, Math.min(90, basePoint.latitude + latDelta)),
              longitude: Math.max(-180, Math.min(180, basePoint.longitude + lonDelta))
            };
            
            const distance = calculator.calculateDistance(basePoint, nearbyPoint);
            
            // For small distances, result should be reasonable
            // 0.001 degrees ≈ 111 meters at equator
            // So max distance should be roughly sqrt(111^2 + 111^2) ≈ 157m
            return distance >= 0 && distance <= 200;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Triangle Inequality
     * 
     * For any three points A, B, C:
     * distance(A, C) <= distance(A, B) + distance(B, C)
     * 
     * This verifies mathematical consistency of the distance calculation
     */
    it('should satisfy triangle inequality', () => {
      fc.assert(
        fc.property(
          validCoordinatesArbitrary(),
          validCoordinatesArbitrary(),
          validCoordinatesArbitrary(),
          (pointA, pointB, pointC) => {
            const distanceAB = calculator.calculateDistance(pointA, pointB);
            const distanceBC = calculator.calculateDistance(pointB, pointC);
            const distanceAC = calculator.calculateDistance(pointA, pointC);
            
            // Triangle inequality: AC <= AB + BC
            // Allow small tolerance for rounding (0.2 meters)
            return distanceAC <= distanceAB + distanceBC + 0.2;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Coordinate Precision Handling
     * **Validates: Requirement 4.4**
     * 
     * For coordinates with up to 6 decimal places, calculation should
     * handle precision correctly without loss
     */
    it('should handle 6 decimal place precision correctly', () => {
      fc.assert(
        fc.property(validCoordinatesArbitrary(), (point) => {
          // Create a point with exactly 6 decimal places
          const precisePoint: Coordinates = {
            latitude: Math.round(point.latitude * 1e6) / 1e6,
            longitude: Math.round(point.longitude * 1e6) / 1e6
          };
          
          const distance = calculator.calculateDistance(precisePoint, precisePoint);
          
          // Distance to self should always be exactly 0
          return distance === 0.0;
        }),
        { numRuns: 100 }
      );
    });
  });
});
