/**
 * Property-based tests for Daily Report Structure
 * 
 * **Property 20: Daily Report Structure**
 * **Validates: Requirements 6.1, 9.3, 9.4**
 */

import * as fc from 'fast-check';
import { ReportGenerator } from '../src/generator/ReportGenerator';
import { ProximityViolation, ReportMetadata, VehicleState } from '../src/models/types';

describe('Daily Report Structure - Property Tests', () => {
  let reportGenerator: ReportGenerator;

  beforeEach(() => {
    reportGenerator = new ReportGenerator();
  });

  /**
   * Property 20: Daily Report Structure
   * **Validates: Requirements 6.1, 9.3, 9.4**
   */
  describe('Property 20: Daily Report Structure', () => {
    it('should include all required fields in daily reports', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') }),
          fc.array(
            fc.record({
              timestamp: fc.date().map(d => d.toISOString()),
              vehicleId: fc.string({ minLength: 5, maxLength: 20 }),
              handheldId: fc.string({ minLength: 5, maxLength: 20 }),
              handheldLatitude: fc.double({ min: -90, max: 90, noNaN: true }),
              handheldLongitude: fc.double({ min: -180, max: 180, noNaN: true }),
              vehicleLatitude: fc.double({ min: -90, max: 90, noNaN: true }),
              vehicleLongitude: fc.double({ min: -180, max: 180, noNaN: true }),
              distance: fc.double({ min: 50.1, max: 1000, noNaN: true }),
              vehicleState: fc.constantFrom(VehicleState.PARKED, VehicleState.MOVING, VehicleState.UNKNOWN),
            }),
            { maxLength: 100 }
          ),
          fc.record({
            processingDuration: fc.integer({ min: 0, max: 900000 }),
            eventsProcessed: fc.integer({ min: 0, max: 100000000 }),
            eventsSkipped: fc.integer({ min: 0, max: 100000000 }),
            devicesWithNoData: fc.record({
              vehicles: fc.array(fc.string({ minLength: 5, maxLength: 20 }), { maxLength: 10 }),
              handhelds: fc.array(fc.string({ minLength: 5, maxLength: 20 }), { maxLength: 10 }),
            }),
          }),
          (date, violations, metadata) => {
            const reportDate = date.toISOString().split('T')[0];
            const report = reportGenerator.generateReport(reportDate, violations, metadata);

            // Verify all required fields are present
            const hasReportDate = typeof report.reportDate === 'string' && report.reportDate.length > 0;
            const hasGeneratedAt = typeof report.generatedAt === 'string' && report.generatedAt.length > 0;

            // Verify summary fields
            const hasSummary =
              typeof report.summary === 'object' &&
              typeof report.summary.totalEvents === 'number' &&
              typeof report.summary.totalVehicles === 'number' &&
              typeof report.summary.totalHandhelds === 'number' &&
              typeof report.summary.totalViolations === 'number' &&
              typeof report.summary.violationRate === 'number';

            // Verify violations array
            const hasViolations = Array.isArray(report.violations);

            // Verify metadata
            const hasMetadata =
              typeof report.metadata === 'object' &&
              typeof report.metadata.processingDuration === 'number' &&
              typeof report.metadata.eventsProcessed === 'number' &&
              typeof report.metadata.eventsSkipped === 'number' &&
              typeof report.metadata.devicesWithNoData === 'object' &&
              Array.isArray(report.metadata.devicesWithNoData.vehicles) &&
              Array.isArray(report.metadata.devicesWithNoData.handhelds);

            // Verify summary statistics are correct
            const correctTotalEvents = report.summary.totalEvents === metadata.eventsProcessed;
            const correctTotalViolations = report.summary.totalViolations === violations.length;

            // Verify violation rate calculation
            const expectedViolationRate =
              metadata.eventsProcessed > 0
                ? Math.round(((violations.length / metadata.eventsProcessed) * 100) * 100) / 100
                : 0;
            const correctViolationRate = report.summary.violationRate === expectedViolationRate;

            return (
              hasReportDate &&
              hasGeneratedAt &&
              hasSummary &&
              hasViolations &&
              hasMetadata &&
              correctTotalEvents &&
              correctTotalViolations &&
              correctViolationRate
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly count unique vehicles and handhelds', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') }),
          fc.array(
            fc.record({
              timestamp: fc.date().map(d => d.toISOString()),
              vehicleId: fc.constantFrom('V1', 'V2', 'V3'), // Limited set for duplicates
              handheldId: fc.constantFrom('H1', 'H2', 'H3'), // Limited set for duplicates
              handheldLatitude: fc.double({ min: -90, max: 90, noNaN: true }),
              handheldLongitude: fc.double({ min: -180, max: 180, noNaN: true }),
              vehicleLatitude: fc.double({ min: -90, max: 90, noNaN: true }),
              vehicleLongitude: fc.double({ min: -180, max: 180, noNaN: true }),
              distance: fc.double({ min: 50.1, max: 1000, noNaN: true }),
              vehicleState: fc.constantFrom(VehicleState.PARKED, VehicleState.MOVING, VehicleState.UNKNOWN),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          fc.record({
            processingDuration: fc.integer({ min: 0, max: 900000 }),
            eventsProcessed: fc.integer({ min: 1, max: 100000000 }),
            eventsSkipped: fc.integer({ min: 0, max: 100000000 }),
            devicesWithNoData: fc.record({
              vehicles: fc.array(fc.string({ minLength: 5, maxLength: 20 }), { maxLength: 10 }),
              handhelds: fc.array(fc.string({ minLength: 5, maxLength: 20 }), { maxLength: 10 }),
            }),
          }),
          (date, violations, metadata) => {
            const reportDate = date.toISOString().split('T')[0];
            const report = reportGenerator.generateReport(reportDate, violations, metadata);

            // Calculate expected unique counts
            const uniqueVehicles = new Set(violations.map(v => v.vehicleId));
            const uniqueHandhelds = new Set(violations.map(v => v.handheldId));

            return (
              report.summary.totalVehicles === uniqueVehicles.size &&
              report.summary.totalHandhelds === uniqueHandhelds.size
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case of zero violations', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-31') }),
          fc.record({
            processingDuration: fc.integer({ min: 0, max: 900000 }),
            eventsProcessed: fc.integer({ min: 0, max: 100000000 }),
            eventsSkipped: fc.integer({ min: 0, max: 100000000 }),
            devicesWithNoData: fc.record({
              vehicles: fc.array(fc.string({ minLength: 5, maxLength: 20 }), { maxLength: 10 }),
              handhelds: fc.array(fc.string({ minLength: 5, maxLength: 20 }), { maxLength: 10 }),
            }),
          }),
          (date, metadata) => {
            const reportDate = date.toISOString().split('T')[0];
            const violations: ProximityViolation[] = [];
            const report = reportGenerator.generateReport(reportDate, violations, metadata);

            return (
              report.summary.totalViolations === 0 &&
              report.summary.totalVehicles === 0 &&
              report.summary.totalHandhelds === 0 &&
              report.summary.violationRate === 0 &&
              report.violations.length === 0
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
