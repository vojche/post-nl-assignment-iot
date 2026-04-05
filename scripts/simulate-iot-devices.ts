/**
 * IoT Device Simulator
 * 
 * Simulates IoT devices publishing GPS events to AWS IoT Core
 * Useful for testing the real-time IoT → Firehose → S3 flow
 */

import { IoTDataPlaneClient, PublishCommand } from '@aws-sdk/client-iot-data';

const NUM_DEVICES = parseInt(process.env.NUM_DEVICES || '10', 10);
const INTERVAL_SECONDS = parseInt(process.env.INTERVAL_SECONDS || '15', 10);
const DURATION_MINUTES = parseInt(process.env.DURATION_MINUTES || '5', 10);

const iotClient = new IoTDataPlaneClient({});

// Amsterdam coordinates
const BASE_LAT = 52.370216;
const BASE_LON = 4.895168;

interface DeviceState {
  vehicleId: string;
  handheldId: string;
  vehicleLat: number;
  vehicleLon: number;
  handheldLat: number;
  handheldLon: number;
}

function randomOffset(max: number): number {
  return (Math.random() - 0.5) * 2 * max;
}

async function publishEvent(topic: string, payload: any): Promise<void> {
  try {
    await iotClient.send(
      new PublishCommand({
        topic,
        payload: Buffer.from(JSON.stringify(payload)),
        qos: 0,
      })
    );
  } catch (error) {
    console.error(`Failed to publish to ${topic}:`, error);
  }
}

async function simulateDevices() {
  console.log(`🚗 Simulating ${NUM_DEVICES} IoT devices`);
  console.log(`⏱️  Publishing every ${INTERVAL_SECONDS} seconds`);
  console.log(`⏰ Duration: ${DURATION_MINUTES} minutes`);
  console.log('');

  // Initialize device states
  const devices: DeviceState[] = [];
  for (let i = 1; i <= NUM_DEVICES; i++) {
    const vehicleId = `VV-AA-AA-AA-${String(i).padStart(4, '0')}`;
    const handheldId = `HH-BB-BB-BB-${String(i).padStart(4, '0')}`;
    
    devices.push({
      vehicleId,
      handheldId,
      vehicleLat: BASE_LAT + randomOffset(0.1),
      vehicleLon: BASE_LON + randomOffset(0.1),
      handheldLat: BASE_LAT + randomOffset(0.1),
      handheldLon: BASE_LON + randomOffset(0.1),
    });
  }

  const totalIterations = (DURATION_MINUTES * 60) / INTERVAL_SECONDS;
  let iteration = 0;

  const intervalId = setInterval(async () => {
    iteration++;
    const timestamp = new Date().toISOString();

    console.log(`\n📡 Publishing events (${iteration}/${totalIterations})...`);

    // Publish events for all devices
    const promises: Promise<void>[] = [];

    for (const device of devices) {
      // Update vehicle position (simulate movement)
      if (Math.random() > 0.3) {
        device.vehicleLat += randomOffset(0.0001);
        device.vehicleLon += randomOffset(0.0001);
      }

      // Update handheld position
      if (Math.random() > 0.1) {
        // 90% of time: stay near vehicle
        device.handheldLat = device.vehicleLat + randomOffset(0.0003);
        device.handheldLon = device.vehicleLon + randomOffset(0.0003);
      } else {
        // 10% of time: get far from vehicle (violation)
        device.handheldLat = device.vehicleLat + randomOffset(0.001);
        device.handheldLon = device.vehicleLon + randomOffset(0.001);
      }

      // Publish vehicle event
      promises.push(
        publishEvent(`v1/gps/vehicle/${device.vehicleId}`, {
          deviceType: 'vehicle',
          deviceId: device.vehicleId,
          latitude: device.vehicleLat,
          longitude: device.vehicleLon,
          timestamp,
        })
      );

      // Publish handheld event
      promises.push(
        publishEvent(`v1/gps/handheld/${device.handheldId}`, {
          deviceType: 'handheld',
          deviceId: device.handheldId,
          latitude: device.handheldLat,
          longitude: device.handheldLon,
          timestamp,
        })
      );
    }

    await Promise.all(promises);
    console.log(`✅ Published ${promises.length} events`);

    if (iteration >= totalIterations) {
      clearInterval(intervalId);
      console.log('\n🎉 Simulation complete!');
      console.log(`\nTotal events published: ${iteration * NUM_DEVICES * 2}`);
      console.log('\nCheck Kinesis Firehose and S3 for delivered events.');
      process.exit(0);
    }
  }, INTERVAL_SECONDS * 1000);
}

// Run simulator
simulateDevices().catch((error) => {
  console.error('❌ Simulation failed:', error);
  process.exit(1);
});
