/**
 * Report Generator
 * 
 * Generates daily reports with summary statistics and all proximity violations.
 * 
 * **Validates: Requirements 6.1, 9.3, 9.4**
 */

import { ProximityViolation, DailyReport, ReportMetadata } from '../models/types';

/**
 * ReportGenerator interface
 */
export interface IReportGenerator {
  /**
   * Generate daily report from violations and metadata
   * @param reportDate - Date in YYYY-MM-DD format
   * @param violations - Array of proximity violations
   * @param metadata - Report metadata
   * @returns Daily report with summary statistics
   */
  generateReport(
    reportDate: string,
    violations: ProximityViolation[],
    metadata: ReportMetadata
  ): DailyReport;
}

/**
 * ReportGenerator implementation
 * 
 * Calculates summary statistics:
 * - totalEvents: Total number of events processed
 * - totalVehicles: Number of unique vehicles
 * - totalHandhelds: Number of unique handhelds
 * - totalViolations: Number of proximity violations
 * - violationRate: Percentage of handheld events that resulted in violations
 */
export class ReportGenerator implements IReportGenerator {
  /**
   * Generate daily report
   */
  generateReport(
    reportDate: string,
    violations: ProximityViolation[],
    metadata: ReportMetadata
  ): DailyReport {
    // Calculate unique vehicles and handhelds from violations
    const uniqueVehicles = new Set<string>();
    const uniqueHandhelds = new Set<string>();

    for (const violation of violations) {
      uniqueVehicles.add(violation.vehicleId);
      uniqueHandhelds.add(violation.handheldId);
    }

    // Calculate violation rate
    // violationRate = (totalViolations / totalEvents) * 100
    const violationRate = metadata.eventsProcessed > 0
      ? (violations.length / metadata.eventsProcessed) * 100
      : 0;

    const report: DailyReport = {
      reportDate,
      generatedAt: new Date().toISOString(),
      summary: {
        totalEvents: metadata.eventsProcessed,
        totalVehicles: uniqueVehicles.size,
        totalHandhelds: uniqueHandhelds.size,
        totalViolations: violations.length,
        violationRate: Math.round(violationRate * 100) / 100, // Round to 2 decimal places
      },
      violations,
      metadata,
    };

    console.log(`[ReportGenerator] Generated report for ${reportDate}: ${violations.length} violations`);
    return report;
  }
}
