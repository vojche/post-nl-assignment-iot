/**
 * Load Test Validation Script
 * 
 * Parses Artillery report JSON and validates against thresholds:
 * - P95 latency thresholds
 * - Error rate thresholds
 * - Fails build if thresholds exceeded
 * 
 * **Validates: Requirements 14.3, 14.4, 14.5, 14.6**
 */

import * as fs from 'fs';
import * as path from 'path';

interface ArtilleryReport {
  aggregate: {
    counters: {
      'vusers.created': number;
      'vusers.completed': number;
      'http.requests': number;
      'http.responses': number;
      errors?: Record<string, number>;
    };
    rates: {
      'http.request_rate': number;
    };
    latency: {
      min: number;
      max: number;
      median: number;
      p95: number;
      p99: number;
    };
  };
}

interface LoadTestThresholds {
  p95LatencyMs: number;
  maxErrorRatePercent: number;
  minSuccessRatePercent: number;
}

const THRESHOLDS: Record<string, LoadTestThresholds> = {
  baseline: {
    p95LatencyMs: 1000,
    maxErrorRatePercent: 0,
    minSuccessRatePercent: 100,
  },
  medium: {
    p95LatencyMs: 2000,
    maxErrorRatePercent: 0.1,
    minSuccessRatePercent: 99.9,
  },
  high: {
    p95LatencyMs: 3000,
    maxErrorRatePercent: 0.1,
    minSuccessRatePercent: 99.9,
  },
  spike: {
    p95LatencyMs: 5000,
    maxErrorRatePercent: 1.0,
    minSuccessRatePercent: 99.0,
  },
};

function validateLoadTest(reportPath: string, testType: string): boolean {
  console.log(`\n📊 Validating load test results: ${testType}`);
  console.log(`📄 Report: ${reportPath}\n`);

  // Read Artillery report
  const reportContent = fs.readFileSync(reportPath, 'utf-8');
  const report: ArtilleryReport = JSON.parse(reportContent);

  const thresholds = THRESHOLDS[testType];
  if (!thresholds) {
    console.error(`❌ Unknown test type: ${testType}`);
    console.error(`   Valid types: ${Object.keys(THRESHOLDS).join(', ')}`);
    return false;
  }

  // Extract metrics
  const p95Latency = report.aggregate.latency.p95;
  const totalRequests = report.aggregate.counters['http.requests'] || 0;
  const totalResponses = report.aggregate.counters['http.responses'] || 0;
  const totalErrors = Object.values(report.aggregate.counters.errors || {}).reduce((a, b) => a + b, 0);
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  const successRate = totalRequests > 0 ? ((totalResponses - totalErrors) / totalRequests) * 100 : 0;

  // Display metrics
  console.log('📈 Test Results:');
  console.log(`   Total Requests: ${totalRequests.toLocaleString()}`);
  console.log(`   Total Responses: ${totalResponses.toLocaleString()}`);
  console.log(`   Total Errors: ${totalErrors.toLocaleString()}`);
  console.log(`   Error Rate: ${errorRate.toFixed(2)}%`);
  console.log(`   Success Rate: ${successRate.toFixed(2)}%`);
  console.log(`   P95 Latency: ${p95Latency.toFixed(2)}ms`);
  console.log(`   Median Latency: ${report.aggregate.latency.median.toFixed(2)}ms`);
  console.log(`   Max Latency: ${report.aggregate.latency.max.toFixed(2)}ms\n`);

  // Validate against thresholds
  let passed = true;

  console.log('✅ Threshold Validation:');

  // Check P95 latency
  if (p95Latency <= thresholds.p95LatencyMs) {
    console.log(`   ✅ P95 Latency: ${p95Latency.toFixed(2)}ms <= ${thresholds.p95LatencyMs}ms`);
  } else {
    console.log(`   ❌ P95 Latency: ${p95Latency.toFixed(2)}ms > ${thresholds.p95LatencyMs}ms`);
    passed = false;
  }

  // Check error rate
  if (errorRate <= thresholds.maxErrorRatePercent) {
    console.log(`   ✅ Error Rate: ${errorRate.toFixed(2)}% <= ${thresholds.maxErrorRatePercent}%`);
  } else {
    console.log(`   ❌ Error Rate: ${errorRate.toFixed(2)}% > ${thresholds.maxErrorRatePercent}%`);
    passed = false;
  }

  // Check success rate
  if (successRate >= thresholds.minSuccessRatePercent) {
    console.log(`   ✅ Success Rate: ${successRate.toFixed(2)}% >= ${thresholds.minSuccessRatePercent}%`);
  } else {
    console.log(`   ❌ Success Rate: ${successRate.toFixed(2)}% < ${thresholds.minSuccessRatePercent}%`);
    passed = false;
  }

  console.log('');

  if (passed) {
    console.log('✅ Load test PASSED - All thresholds met\n');
    return true;
  } else {
    console.log('❌ Load test FAILED - One or more thresholds exceeded\n');
    return false;
  }
}

// Main execution
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: npx ts-node validate-load-test.ts <report-path> <test-type>');
  console.error('Test types: baseline, medium, high, spike');
  process.exit(1);
}

const [reportPath, testType] = args;

if (!fs.existsSync(reportPath)) {
  console.error(`❌ Report file not found: ${reportPath}`);
  process.exit(1);
}

const passed = validateLoadTest(reportPath, testType);
process.exit(passed ? 0 : 1);
