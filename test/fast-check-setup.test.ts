/**
 * Verify fast-check property-based testing is configured correctly
 */

import * as fc from 'fast-check';

describe('Property-Based Testing Setup', () => {
  it('should run a simple property test', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a; // Commutativity of addition
      }),
      { numRuns: 100 }
    );
  });

  it('should generate valid coordinates', () => {
    const coordinatesArbitrary = fc.record({
      latitude: fc.double({ min: -90, max: 90, noNaN: true }),
      longitude: fc.double({ min: -180, max: 180, noNaN: true })
    });

    fc.assert(
      fc.property(coordinatesArbitrary, (coords) => {
        return !isNaN(coords.latitude) &&
               !isNaN(coords.longitude) &&
               coords.latitude >= -90 && 
               coords.latitude <= 90 &&
               coords.longitude >= -180 && 
               coords.longitude <= 180;
      }),
      { numRuns: 100 }
    );
  });
});
