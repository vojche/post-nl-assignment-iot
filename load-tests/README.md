# Load Testing Guide

This directory contains Artillery load test scenarios for the IoT Proximity Alert System.

## Prerequisites

```bash
npm install -g artillery
npm install @faker-js/faker
```

## Test Scenarios

### 1. Baseline Load (100 vehicles)
- 100 vehicles sending GPS updates every 30 seconds
- 50 handhelds sending GPS updates every 10 seconds
- Duration: 10 minutes
- Expected: P95 latency < 1 second, 0 errors

```bash
export IOT_ENDPOINT=your-iot-endpoint.iot.eu-west-1.amazonaws.com
artillery run baseline-load.yml --output baseline-report.json
npx ts-node validate-load-test.ts baseline-report.json baseline
```

### 2. Medium Load (500 vehicles)
- 500 vehicles sending GPS updates every 30 seconds
- 250 handhelds sending GPS updates every 10 seconds
- Duration: 10 minutes
- Expected: P95 latency < 2 seconds, error rate < 0.1%

```bash
artillery run medium-load.yml --output medium-report.json
npx ts-node validate-load-test.ts medium-report.json medium
```

### 3. High Load (1000 vehicles)
- 1000 vehicles sending GPS updates every 30 seconds
- 500 handhelds sending GPS updates every 10 seconds
- Duration: 10 minutes
- Expected: P95 latency < 3 seconds, error rate < 0.1%

```bash
artillery run high-load.yml --output high-report.json
npx ts-node validate-load-test.ts high-report.json high
```

### 4. Spike Test
- Sudden increase from 100 to 1000 vehicles over 1 minute
- Maintain 1000 vehicles for 5 minutes
- Gradual decrease back to 100 over 2 minutes
- Expected: System scales automatically, no failures

```bash
artillery run spike-test.yml --output spike-report.json
npx ts-node validate-load-test.ts spike-report.json spike
```

## CI/CD Integration

Add to buildspec-load-test.yml:

```yaml
phases:
  build:
    commands:
      - npm install -g artillery
      - npm install @faker-js/faker
      - export IOT_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)
      - artillery run load-tests/baseline-load.yml --output baseline-report.json
      - npx ts-node load-tests/validate-load-test.ts baseline-report.json baseline
```

## Monitoring During Load Tests

Watch CloudWatch metrics:
- Lambda concurrent executions
- Kinesis Firehose delivery success rate
- DynamoDB consumed capacity
- IoT Core message delivery rate

## Troubleshooting

If tests fail:
1. Check CloudWatch Logs for Lambda errors
2. Check IoT Core error queue for failed deliveries
3. Check DynamoDB throttling metrics
4. Increase Lambda memory or timeout if needed
5. Enable X-Ray tracing for detailed analysis
