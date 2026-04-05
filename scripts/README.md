# Scripts Documentation

This directory contains utility scripts for testing and data generation.

## Available Scripts

### 1. populate-test-data.ts

Populates the DynamoDB Vehicle2HandheldTable with test vehicle-handheld mappings.

**Usage:**
```bash
export TABLE_NAME=Vehicle2HandheldTable-production
export NUM_DEVICES=2000

npx ts-node scripts/populate-test-data.ts
```

**Environment Variables:**
- `TABLE_NAME` (required): DynamoDB table name
- `NUM_DEVICES` (optional): Number of device pairs to create (default: 2000)

**Output:**
- Creates mappings: `VV-AA-AA-AA-{id}` → `HH-BB-BB-BB-{id}`
- Batch writes to DynamoDB (25 items per batch)
- Progress indicator with percentage complete

**Example:**
```bash
# Small scale (10 devices)
export TABLE_NAME=Vehicle2HandheldTable-production
export NUM_DEVICES=10
npx ts-node scripts/populate-test-data.ts

# Full scale (2000 devices)
export TABLE_NAME=Vehicle2HandheldTable-production
export NUM_DEVICES=2000
npx ts-node scripts/populate-test-data.ts
```

---

### 2. generate-test-events.ts

Generates realistic GPS events and uploads them to S3 for batch processing.

**Usage:**
```bash
export BUCKET_NAME=iot-proximity-events-ACCOUNT-production
export NUM_DEVICES=2000
export DATE=2024-01-15

npx ts-node scripts/generate-test-events.ts
```

**Environment Variables:**
- `BUCKET_NAME` (required): S3 bucket name for events
- `NUM_DEVICES` (optional): Number of device pairs (default: 2000)
- `DATE` (optional): Date for events in YYYY-MM-DD format (default: today)

**Output:**
- Generates GPS events for a full day (24 hours)
- Events every 15 seconds per device
- 90% normal proximity, 10% violations
- Uploads to S3 with partitioning: `events/year=YYYY/month=MM/day=DD/`

**Event Statistics (2000 devices):**
- Total events: 23,040,000
- Vehicle events: 11,520,000
- Handheld events: 11,520,000
- Expected violations: ~1,152,000 (10%)
- File size: ~4.6 GB compressed
- Upload time: ~4 minutes

**Example:**
```bash
# Small scale (10 devices)
export BUCKET_NAME=iot-proximity-events-123456789012-production
export NUM_DEVICES=10
export DATE=2024-01-15
npx ts-node scripts/generate-test-events.ts

# Full scale (2000 devices)
export BUCKET_NAME=iot-proximity-events-123456789012-production
export NUM_DEVICES=2000
export DATE=2024-01-15
npx ts-node scripts/generate-test-events.ts
```

---

### 3. simulate-iot-devices.ts

Simulates IoT devices publishing GPS events to AWS IoT Core in real-time via MQTT.

**Usage:**
```bash
export NUM_DEVICES=10
export INTERVAL_SECONDS=15
export DURATION_MINUTES=5

npx ts-node scripts/simulate-iot-devices.ts
```

**Environment Variables:**
- `NUM_DEVICES` (optional): Number of device pairs to simulate (default: 10)
- `INTERVAL_SECONDS` (optional): Seconds between GPS updates (default: 15)
- `DURATION_MINUTES` (optional): Total simulation duration (default: 5)

**Output:**
- Publishes events to IoT Core topics:
  - `v1/gps/vehicle/{vehicleId}`
  - `v1/gps/handheld/{handheldId}`
- Events flow through Kinesis Firehose to S3
- Real-time progress updates

**Event Flow:**
1. Script publishes to IoT Core MQTT topics
2. IoT Core rule matches events: `SELECT * FROM 'v1/gps/+/#'`
3. Firehose delivers events to S3 (buffered up to 5 minutes)
4. Lambda processes events on schedule or manual invocation

**Example:**
```bash
# Short test (10 devices, 5 minutes)
export NUM_DEVICES=10
export INTERVAL_SECONDS=15
export DURATION_MINUTES=5
npx ts-node scripts/simulate-iot-devices.ts

# Extended test (100 devices, 30 minutes)
export NUM_DEVICES=100
export INTERVAL_SECONDS=15
export DURATION_MINUTES=30
npx ts-node scripts/simulate-iot-devices.ts
```

**Note:** Requires AWS credentials with IoT Data Plane permissions (`iot:Publish`).

---

## Testing Approaches

### Approach 1: Batch Upload (Recommended)

**Best for:** Fast, reproducible testing with large datasets

**Steps:**
1. Generate events offline: `generate-test-events.ts`
2. Upload to S3 (automated by script)
3. Process with Lambda

**Pros:**
- ✅ Fast (23M events in ~4 minutes)
- ✅ Cheap (no IoT Core costs)
- ✅ Reproducible
- ✅ No MQTT setup

**Cons:**
- ❌ Not real-time
- ❌ Doesn't test IoT Core rule

---

### Approach 2: Real-time MQTT (Optional)

**Best for:** End-to-end testing with IoT Core

**Steps:**
1. Simulate devices: `simulate-iot-devices.ts`
2. Wait for Firehose delivery (up to 5 minutes)
3. Process with Lambda

**Pros:**
- ✅ Tests complete flow
- ✅ Real-time delivery
- ✅ Realistic simulation

**Cons:**
- ❌ Slower (real-time only)
- ❌ More expensive (IoT Core charges)
- ❌ Requires IoT permissions

---

## NPM Scripts

The following scripts are available in `package.json`:

```json
{
  "scripts": {
    "data:populate": "ts-node scripts/populate-test-data.ts",
    "data:generate-events": "ts-node scripts/generate-test-events.ts",
    "data:simulate-iot": "ts-node scripts/simulate-iot-devices.ts",
    "report:generate": "ts-node scripts/generate-html-report.ts"
  }
}
```

**Usage:**
```bash
# Populate DynamoDB
TABLE_NAME=Vehicle2HandheldTable-production NUM_DEVICES=2000 npm run data:populate

# Generate test events
BUCKET_NAME=iot-proximity-events-ACCOUNT-production NUM_DEVICES=2000 DATE=2024-01-15 npm run data:generate-events

# Simulate IoT devices
NUM_DEVICES=10 INTERVAL_SECONDS=15 DURATION_MINUTES=5 npm run data:simulate-iot

# Generate HTML report
npm run report:generate
```

---

## Cost Estimates

### Batch Upload Approach
- **S3 PUT:** ~$0.01 (2,304 files)
- **Lambda:** ~$0.50 (processing)
- **Total:** ~$0.51 per test

### Real-time MQTT Approach
- **IoT Core:** $5 per million messages
  - 10 devices × 2 events × 20 updates = 400 messages
  - Cost: ~$0.002
- **Firehose:** $0.029 per GB
  - 400 events × 200 bytes = 80 KB
  - Cost: ~$0.0001
- **Lambda:** ~$0.50 (processing)
- **Total:** ~$0.50 per test

---

## Troubleshooting

### DynamoDB Throttling
**Symptom:** "ProvisionedThroughputExceededException"

**Solution:** Table uses on-demand billing mode, but check:
```bash
aws dynamodb describe-table --table-name Vehicle2HandheldTable-production | jq .Table.BillingModeSummary
```

### S3 Access Denied
**Symptom:** "Access Denied" when uploading events

**Solution:** Ensure AWS credentials have S3 write permissions:
```bash
aws s3 ls s3://iot-proximity-events-ACCOUNT-production/
```

### IoT Publish Failed
**Symptom:** "Not authorized to perform: iot:Publish"

**Solution:** Ensure AWS credentials have IoT Data Plane permissions:
```bash
aws iot-data publish \
  --topic v1/gps/test \
  --payload '{"test":true}' \
  --cli-binary-format raw-in-base64-out
```

### Events Not in S3 (Real-time)
**Symptom:** Simulator publishes but S3 remains empty

**Solution:** Firehose buffers for up to 5 minutes. Wait or publish more events to trigger size-based flush.

---

## Quick Reference

### Full Scale Testing (2000 devices)
```bash
# 1. Populate DynamoDB
export TABLE_NAME=Vehicle2HandheldTable-production
export NUM_DEVICES=2000
npx ts-node scripts/populate-test-data.ts

# 2. Generate events
export BUCKET_NAME=iot-proximity-events-ACCOUNT-production
export NUM_DEVICES=2000
export DATE=2024-01-15
npx ts-node scripts/generate-test-events.ts

# 3. Process events
aws lambda invoke \
  --function-name iot-proximity-batch-processor-production \
  --payload '{"processingDate":"2024-01-15"}' \
  response.json
```

### Small Scale Testing (10 devices)
```bash
# 1. Populate DynamoDB
export TABLE_NAME=Vehicle2HandheldTable-production
export NUM_DEVICES=10
npx ts-node scripts/populate-test-data.ts

# 2. Generate events
export BUCKET_NAME=iot-proximity-events-ACCOUNT-production
export NUM_DEVICES=10
export DATE=2024-01-15
npx ts-node scripts/generate-test-events.ts

# 3. Process events
aws lambda invoke \
  --function-name iot-proximity-batch-processor-production \
  --payload '{"processingDate":"2024-01-15"}' \
  response.json
```

### Real-time Testing
```bash
# 1. Populate DynamoDB
export TABLE_NAME=Vehicle2HandheldTable-production
export NUM_DEVICES=10
npx ts-node scripts/populate-test-data.ts

# 2. Simulate devices
export NUM_DEVICES=10
export INTERVAL_SECONDS=15
export DURATION_MINUTES=5
npx ts-node scripts/simulate-iot-devices.ts

# 3. Wait 5 minutes for Firehose delivery

# 4. Process today's events
aws lambda invoke \
  --function-name iot-proximity-batch-processor-production \
  --payload "{\"processingDate\":\"$(date +%Y-%m-%d)\"}" \
  response.json
```

---

## See Also

- [Main README](../README.md) - Complete project documentation
- [Load Tests README](../load-tests/README.md) - Load testing guide
- [CloudWatch Insights Queries](../monitoring/cloudwatch-insights-queries.md) - Monitoring queries
