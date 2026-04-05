# CloudWatch Logs Insights Queries

This document contains saved CloudWatch Logs Insights queries for the IoT Proximity Alert System.

## Setup

1. Go to CloudWatch → Logs → Insights
2. Select log group: `/aws/lambda/iot-proximity-batch-processor-{environment}`
3. Copy and paste queries below
4. Click "Save" to save each query for easy access

## Queries

### 1. Validation Errors

Find all validation errors with device IDs and error details.

```
fields @timestamp, @message
| filter @message like /validation error/i or @message like /invalid/i
| parse @message /deviceId: (?<deviceId>[^\s,]+)/
| parse @message /error: (?<error>[^\n]+)/
| stats count() by deviceId, error
| sort count desc
```

**Use case**: Identify devices sending invalid data

---

### 2. Average Processing Duration by Device Type

Calculate average processing time for vehicle vs handheld events.

```
fields @timestamp, @message
| filter @message like /processing duration/i
| parse @message /deviceType: (?<deviceType>[^\s,]+)/
| parse @message /duration: (?<duration>\d+)/
| stats avg(duration) as avgDuration, max(duration) as maxDuration, min(duration) as minDuration by deviceType
```

**Use case**: Identify performance bottlenecks by device type

---

### 3. Proximity Alerts Triggered

List all proximity alerts with distance and vehicle state.

```
fields @timestamp, @message
| filter @message like /proximity alert/i or @message like /violation detected/i
| parse @message /vehicleId: (?<vehicleId>[^\s,]+)/
| parse @message /handheldId: (?<handheldId>[^\s,]+)/
| parse @message /distance: (?<distance>[\d.]+)/
| parse @message /vehicleState: (?<vehicleState>[^\s,]+)/
| sort @timestamp desc
| limit 100
```

**Use case**: Review recent proximity violations

---

### 4. Error Rate by Hour

Calculate error rate per hour to identify patterns.

```
fields @timestamp, @message
| filter @message like /ERROR/
| stats count() as errorCount by bin(1h)
| sort bin desc
```

**Use case**: Identify peak error times

---

### 5. DynamoDB Throttling Events

Find DynamoDB throttling errors and retry attempts.

```
fields @timestamp, @message
| filter @message like /ProvisionedThroughputExceededException/ or @message like /throttl/i
| parse @message /table: (?<table>[^\s,]+)/
| parse @message /operation: (?<operation>[^\s,]+)/
| stats count() as throttleCount by table, operation
| sort throttleCount desc
```

**Use case**: Identify DynamoDB capacity issues

---

### 6. SNS Publication Failures

Find failed SNS publications with error details.

```
fields @timestamp, @message
| filter @message like /SNS publish failed/i or @message like /AlertPublicationFailure/
| parse @message /topicArn: (?<topicArn>[^\s,]+)/
| parse @message /error: (?<error>[^\n]+)/
| stats count() as failureCount by error
| sort failureCount desc
```

**Use case**: Troubleshoot alert delivery issues

---

### 7. Batch Job Summary

Get summary statistics for each batch job execution.

```
fields @timestamp, @message
| filter @message like /batch job completed/i or @message like /processing summary/i
| parse @message /processingDate: (?<processingDate>[^\s,]+)/
| parse @message /eventsProcessed: (?<eventsProcessed>\d+)/
| parse @message /violationsDetected: (?<violationsDetected>\d+)/
| parse @message /duration: (?<duration>\d+)/
| sort @timestamp desc
| limit 20
```

**Use case**: Monitor daily batch job performance

---

### 8. Top Violators

Identify vehicles with most proximity violations.

```
fields @timestamp, @message
| filter @message like /proximity alert/i
| parse @message /vehicleId: (?<vehicleId>[^\s,]+)/
| stats count() as violationCount by vehicleId
| sort violationCount desc
| limit 10
```

**Use case**: Identify problematic vehicles for investigation

---

### 9. Cold Start Analysis

Analyze Lambda cold start duration.

```
fields @timestamp, @message, @initDuration
| filter @type = "REPORT"
| stats avg(@initDuration) as avgColdStart, max(@initDuration) as maxColdStart, count(@initDuration) as coldStartCount
```

**Use case**: Optimize Lambda cold start performance

---

### 10. Memory Usage Analysis

Analyze Lambda memory usage to optimize allocation.

```
fields @timestamp, @message, @maxMemoryUsed, @memorySize
| filter @type = "REPORT"
| stats avg(@maxMemoryUsed) as avgMemoryUsed, max(@maxMemoryUsed) as maxMemoryUsed, avg(@memorySize) as allocatedMemory
```

**Use case**: Right-size Lambda memory allocation

---

## Saving Queries

To save a query:
1. Run the query in CloudWatch Logs Insights
2. Click "Save" button
3. Enter query name (e.g., "Validation Errors")
4. Select log group
5. Click "Save"

Saved queries appear in the "Saved queries" dropdown for quick access.

## Alerting on Query Results

You can create CloudWatch alarms based on Logs Insights queries:
1. Run query
2. Click "Actions" → "Create metric filter"
3. Define metric filter pattern
4. Create alarm on metric

Example: Alert when error rate exceeds threshold.
