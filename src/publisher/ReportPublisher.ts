/**
 * Report Publisher
 * 
 * Publishes daily reports to SNS and stores them in S3 for historical analysis.
 * Implements retry logic with exponential backoff for resilience.
 * 
 * **Validates: Requirements 6.2, 6.6, 6.7, 9.1, 9.2, 13.8**
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DailyReport } from '../models/types';

/**
 * ReportPublisher interface
 */
export interface IReportPublisher {
  /**
   * Publish report to SNS topic
   * @param report - Daily report to publish
   * @throws Error if publishing fails after retries
   */
  publishToSNS(report: DailyReport): Promise<void>;

  /**
   * Store report in S3 with date-based partitioning
   * @param report - Daily report to store
   * @throws Error if storage fails after retries
   */
  storeInS3(report: DailyReport): Promise<void>;
}

/**
 * Configuration for ReportPublisher
 */
export interface ReportPublisherConfig {
  snsTopicArn: string;
  s3BucketName: string;
  maxRetries?: number;
  initialRetryDelayMs?: number;
}

/**
 * ReportPublisher implementation
 * 
 * Features:
 * - Publishes reports to SNS as JSON strings
 * - Stores reports in S3 with date partitioning (reports/year=YYYY/month=MM/day=DD/report.json)
 * - Retry logic with exponential backoff (3 attempts by default)
 * - Comprehensive error logging
 */
export class ReportPublisher implements IReportPublisher {
  private readonly snsClient: SNSClient;
  private readonly s3Client: S3Client;
  private readonly config: Required<ReportPublisherConfig>;

  constructor(config: ReportPublisherConfig) {
    this.snsClient = new SNSClient({});
    this.s3Client = new S3Client({});
    this.config = {
      ...config,
      maxRetries: config.maxRetries ?? 3,
      initialRetryDelayMs: config.initialRetryDelayMs ?? 100,
    };
  }

  /**
   * Publish report to SNS with retry logic
   */
  async publishToSNS(report: DailyReport): Promise<void> {
    const message = JSON.stringify(report);
    
    await this.retryWithBackoff(
      async () => {
        const command = new PublishCommand({
          TopicArn: this.config.snsTopicArn,
          Message: message,
          Subject: `Daily Proximity Report - ${report.reportDate}`,
        });

        await this.snsClient.send(command);
        console.log(`[ReportPublisher] Published report to SNS for ${report.reportDate}`);
      },
      'SNS publish'
    );
  }

  /**
   * Store report in S3 with date-based partitioning
   * Format: reports/year=YYYY/month=MM/day=DD/report.json
   */
  async storeInS3(report: DailyReport): Promise<void> {
    const s3Key = this.buildS3Key(report.reportDate);
    const body = JSON.stringify(report, null, 2);

    await this.retryWithBackoff(
      async () => {
        const command = new PutObjectCommand({
          Bucket: this.config.s3BucketName,
          Key: s3Key,
          Body: body,
          ContentType: 'application/json',
        });

        await this.s3Client.send(command);
        console.log(`[ReportPublisher] Stored report in S3: s3://${this.config.s3BucketName}/${s3Key}`);
      },
      'S3 storage'
    );
  }

  /**
   * Build S3 key with date partitioning
   * @param reportDate - Date in YYYY-MM-DD format
   * @returns S3 key path
   */
  private buildS3Key(reportDate: string): string {
    const [year, month, day] = reportDate.split('-');
    return `reports/year=${year}/month=${month}/day=${day}/report.json`;
  }

  /**
   * Retry operation with exponential backoff
   * @param operation - Async operation to retry
   * @param operationName - Name for logging
   */
  private async retryWithBackoff(
    operation: () => Promise<void>,
    operationName: string
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await operation();
        return; // Success
      } catch (error) {
        lastError = error as Error;
        console.error(
          `[ReportPublisher] ${operationName} failed (attempt ${attempt}/${this.config.maxRetries}):`,
          error
        );

        if (attempt < this.config.maxRetries) {
          const delayMs = this.config.initialRetryDelayMs * Math.pow(2, attempt - 1);
          console.log(`[ReportPublisher] Retrying ${operationName} in ${delayMs}ms...`);
          await this.sleep(delayMs);
        }
      }
    }

    // All retries exhausted
    throw new Error(
      `${operationName} failed after ${this.config.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
