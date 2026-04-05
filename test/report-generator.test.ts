/**
 * Unit tests for ReportGenerator
 * 
 * Tests report generation with violations, no violations, summary statistics calculation,
 * and metadata inclusion.
 */

import { ReportGenerator } from '../src/generator/ReportGenerator';
import { ProximityViolation, ReportMetadata, VehicleState } from '../src/models/types';

describe('ReportGenerator', () => {
  let reportGenerator: ReportGenerator;

  beforeEach(() => {
    reportGenerator = new ReportGenerator();
  });

  describe('generateReport', () => {
    it('should generate report with violations', () => {
      const reportDate = '2024-01-15';
      const violations: ProximityViolation[] = [
        {
          timestamp: '2024-01-15T10:00:00Z',
          vehicleId: 'VV-AA-AA-AA-01',
          handheldId: 'HH-BB-BB-BB-01',
          handheldLatitude: 52.379800,
          handheldLongitude: 4.899500,
          vehicleLatitude: 52.379189,
          vehicleLongitude: 4.899431,
          distance: 75.3,
          vehicleState: VehicleState.PARKED,
        },
        {
          timestamp: '2024-01-15T11:00:00Z',
          vehicleId: 'VV-AA-AA-AA-02',
          handheldId: 'HH-BB-BB-BB-02',
          handheldLatitude: 52.380000,
          handheldLongitude: 4.900000,
          vehicleLatitude: 52.379500,
          vehicleLongitude: 4.899500,
          distance: 65.2,
          vehicleState: VehicleState.PARKED,
        },
      ];

      const metadata: ReportMetadata = {
        processingDuration: 850000,
        eventsProcessed: 1000, // More realistic for testing
        eventsSkipped: 500,
        devicesWithNoData: {
          vehicles: [],
          handhelds: [],
        },
      };

      const report = reportGenerator.generateReport(reportDate, violations, metadata);

      expect(report.reportDate).toBe('2024-01-15');
      expect(report.generatedAt).toBeDefined();
      expect(report.summary.totalEvents).toBe(1000);
      expect(report.summary.totalVehicles).toBe(2);
      expect(report.summary.totalHandhelds).toBe(2);
      expect(report.summary.totalViolations).toBe(2);
      expect(report.summary.violationRate).toBe(0.2); // (2/1000) * 100 = 0.2%
      expect(report.violations).toHaveLength(2);
      expect(report.metadata).toEqual(metadata);
    });

    it('should generate report with no violations', () => {
      const reportDate = '2024-01-15';
      const violations: ProximityViolation[] = [];

      const metadata: ReportMetadata = {
        processingDuration: 850000,
        eventsProcessed: 23000000,
        eventsSkipped: 16100000,
        devicesWithNoData: {
          vehicles: [],
          handhelds: [],
        },
      };

      const report = reportGenerator.generateReport(reportDate, violations, metadata);

      expect(report.reportDate).toBe('2024-01-15');
      expect(report.summary.totalEvents).toBe(23000000);
      expect(report.summary.totalVehicles).toBe(0);
      expect(report.summary.totalHandhelds).toBe(0);
      expect(report.summary.totalViolations).toBe(0);
      expect(report.summary.violationRate).toBe(0);
      expect(report.violations).toHaveLength(0);
    });

    it('should calculate summary statistics correctly', () => {
      const reportDate = '2024-01-15';
      const violations: ProximityViolation[] = [
        {
          timestamp: '2024-01-15T10:00:00Z',
          vehicleId: 'VV-AA-AA-AA-01',
          handheldId: 'HH-BB-BB-BB-01',
          handheldLatitude: 52.379800,
          handheldLongitude: 4.899500,
          vehicleLatitude: 52.379189,
          vehicleLongitude: 4.899431,
          distance: 75.3,
          vehicleState: VehicleState.PARKED,
        },
        {
          timestamp: '2024-01-15T11:00:00Z',
          vehicleId: 'VV-AA-AA-AA-01', // Same vehicle
          handheldId: 'HH-BB-BB-BB-01', // Same handheld
          handheldLatitude: 52.380000,
          handheldLongitude: 4.900000,
          vehicleLatitude: 52.379500,
          vehicleLongitude: 4.899500,
          distance: 65.2,
          vehicleState: VehicleState.PARKED,
        },
      ];

      const metadata: ReportMetadata = {
        processingDuration: 850000,
        eventsProcessed: 1000,
        eventsSkipped: 500,
        devicesWithNoData: {
          vehicles: [],
          handhelds: [],
        },
      };

      const report = reportGenerator.generateReport(reportDate, violations, metadata);

      // Should count unique vehicles and handhelds
      expect(report.summary.totalVehicles).toBe(1);
      expect(report.summary.totalHandhelds).toBe(1);
      expect(report.summary.totalViolations).toBe(2);

      // Violation rate = (2 / 1000) * 100 = 0.2%
      expect(report.summary.violationRate).toBe(0.2);
    });

    it('should include metadata in report', () => {
      const reportDate = '2024-01-15';
      const violations: ProximityViolation[] = [];

      const metadata: ReportMetadata = {
        processingDuration: 850000,
        eventsProcessed: 23000000,
        eventsSkipped: 16100000,
        devicesWithNoData: {
          vehicles: ['VV-AA-AA-AA-99'],
          handhelds: ['HH-BB-BB-BB-88', 'HH-BB-BB-BB-89'],
        },
      };

      const report = reportGenerator.generateReport(reportDate, violations, metadata);

      expect(report.metadata.processingDuration).toBe(850000);
      expect(report.metadata.eventsProcessed).toBe(23000000);
      expect(report.metadata.eventsSkipped).toBe(16100000);
      expect(report.metadata.devicesWithNoData.vehicles).toEqual(['VV-AA-AA-AA-99']);
      expect(report.metadata.devicesWithNoData.handhelds).toEqual(['HH-BB-BB-BB-88', 'HH-BB-BB-BB-89']);
    });

    it('should handle zero events processed', () => {
      const reportDate = '2024-01-15';
      const violations: ProximityViolation[] = [];

      const metadata: ReportMetadata = {
        processingDuration: 0,
        eventsProcessed: 0,
        eventsSkipped: 0,
        devicesWithNoData: {
          vehicles: [],
          handhelds: [],
        },
      };

      const report = reportGenerator.generateReport(reportDate, violations, metadata);

      expect(report.summary.violationRate).toBe(0);
    });

    it('should round violation rate to 2 decimal places', () => {
      const reportDate = '2024-01-15';
      const violations: ProximityViolation[] = [
        {
          timestamp: '2024-01-15T10:00:00Z',
          vehicleId: 'VV-AA-AA-AA-01',
          handheldId: 'HH-BB-BB-BB-01',
          handheldLatitude: 52.379800,
          handheldLongitude: 4.899500,
          vehicleLatitude: 52.379189,
          vehicleLongitude: 4.899431,
          distance: 75.3,
          vehicleState: VehicleState.PARKED,
        },
      ];

      const metadata: ReportMetadata = {
        processingDuration: 850000,
        eventsProcessed: 3,
        eventsSkipped: 0,
        devicesWithNoData: {
          vehicles: [],
          handhelds: [],
        },
      };

      const report = reportGenerator.generateReport(reportDate, violations, metadata);

      // Violation rate = (1 / 3) * 100 = 33.333...%
      // Should be rounded to 33.33%
      expect(report.summary.violationRate).toBe(33.33);
    });

    it('should include generatedAt timestamp', () => {
      const reportDate = '2024-01-15';
      const violations: ProximityViolation[] = [];

      const metadata: ReportMetadata = {
        processingDuration: 0,
        eventsProcessed: 0,
        eventsSkipped: 0,
        devicesWithNoData: {
          vehicles: [],
          handhelds: [],
        },
      };

      const beforeGeneration = new Date().toISOString();
      const report = reportGenerator.generateReport(reportDate, violations, metadata);
      const afterGeneration = new Date().toISOString();

      expect(report.generatedAt).toBeDefined();
      expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(report.generatedAt >= beforeGeneration).toBe(true);
      expect(report.generatedAt <= afterGeneration).toBe(true);
    });
  });
});
