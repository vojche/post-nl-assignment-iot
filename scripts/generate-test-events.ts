/**
 * Generate Test IoT Events
 * 
 * This script generates realistic GPS events for testing:
 * - Vehicle events (moving and parked)
 * - Handheld events (near and far from vehicles)
 * - Events every 15 seconds for a full day
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createGzip } from 'zlib';
import { Readable } from 'stream';

const BUCKET_NAME = process.env.BUCKET_NAME || 'iot-proximity-events-ACCOUNT-production';
const NUM_DEVICES = parseInt(process.env.NUM_DEVICES || '10', 10); // Default to 10 for testing
const DATE = process.env.DATE || '2024-01-15';

const s3Client = new S3Client({});

// Amsterdam coordinates
const BASE_LAT = 52.370216;
const BASE_LON = 4.895168;

interface Event {
  deviceType: 'vehicle' | 'handheld';
  deviceId: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

/**
 * Generate random offset for coordinates
 */
function randomOffset(max: number): number {
  return (Math.random() - 0.5) * 2 * max;
}

/**
 * Generate events for one day (every 15 seconds = 5,760 events per device)
 */
function generateDayEvents(deviceNum: number): Event[] {
  const events: Event[] = [];
  const vehicleId = `VV-AA-AA-AA-${String(deviceNum).padStart(4, '0')}`;
  const handheldId = `HH-BB-BB-BB-${String(deviceNum).padStart(4, '0')}`;

  // Start at midnight
  const startTime = new Date(`${DATE}T00:00:00Z`);
  
  // Vehicle starts at a random location
  let vehicleLat = BASE_LAT + randomOffset(0.1); // ~11km range
  let vehicleLon = BASE_LON + randomOffset(0.1);
  
  // Handheld starts near vehicle
  let handheldLat = vehicleLat + randomOffset(0.0001); // ~11m range
  let handheldLon = vehicleLon + randomOffset(0.0001);

  // Generate events every 15 seconds for 24 hours
  const INTERVAL_SECONDS = 15;
  const EVENTS_PER_DAY = (24 * 60 * 60) / INTERVAL_SECONDS; // 5,760

  for (let i = 0; i < EVENTS_PER_DAY; i++) {
    const timestamp = new Date(startTime.getTime() + i * INTERVAL_SECONDS * 1000).toISOString();

    // Simulate vehicle movement patterns
    const hour = Math.floor((i * INTERVAL_SECONDS) / 3600);
    
    // Vehicle is MOVING during work hours (8 AM - 6 PM)
    const isWorkHours = hour >= 8 && hour < 18;
    
    if (isWorkHours && Math.random() > 0.3) {
      // Vehicle moves (70% of time during work hours)
      vehicleLat += randomOffset(0.0001); // ~11m per 15 seconds
      vehicleLon += randomOffset(0.0001);
    }

    // Add vehicle event
    events.push({
      deviceType: 'vehicle',
      deviceId: vehicleId,
      latitude: vehicleLat,
      longitude: vehicleLon,
      timestamp,
    });

    // Handheld follows vehicle but sometimes gets far
    if (Math.random() > 0.1) {
      // 90% of time: handheld stays near vehicle (<50m)
      handheldLat = vehicleLat + randomOffset(0.0003); // ~33m range
      handheldLon = vehicleLon + randomOffset(0.0003);
    } else {
      // 10% of time: handheld gets far from vehicle (>50m) - VIOLATION
      handheldLat = vehicleLat + randomOffset(0.001); // ~111m range
      handheldLon = vehicleLon + randomOffset(0.001);
    }

    // Add handheld event
    events.push({
      deviceType: 'handheld',
      deviceId: handheldId,
      latitude: handheldLat,
      longitude: handheldLon,
      timestamp,
    });
  }

  return events;
}

/**
 * Compress events to GZIP
 */
async function compressEvents(events: Event[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gzip = createGzip();

    gzip.on('data', (chunk) => chunks.push(chunk));
    gzip.on('end', () => resolve(Buffer.concat(chunks)));
    gzip.on('error', reject);

    // Write newline-delimited JSON
    const jsonLines = events.map(e => JSON.stringify(e)).join('\n');
    gzip.write(jsonLines);
    gzip.end();
  });
}

/**
 * Upload events to S3
 */
async function uploadToS3(buffer: Buffer, key: string): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
    })
  );
}

/**
 * Main function
 */
async function generateTestEvents() {
  console.log(`📅 Generating test events for ${DATE}`);
  console.log(`📊 Devices: ${NUM_DEVICES} vehicles + ${NUM_DEVICES} handhelds`);
  console.log(`📍 Location: Amsterdam area (${BASE_LAT}, ${BASE_LON})`);
  console.log(`⏱️  Interval: 15 seconds`);
  console.log(`📦 Bucket: ${BUCKET_NAME}`);
  console.log('');

  const [year, month, day] = DATE.split('-');
  const s3Prefix = `events/year=${year}/month=${month}/day=${day}`;

  const startTime = Date.now();

  // Generate events for all devices
  console.log('🔄 Generating events...');
  const allEvents: Event[] = [];
  
  for (let i = 1; i <= NUM_DEVICES; i++) {
    const deviceEvents = generateDayEvents(i);
    allEvents.push(...deviceEvents);
    
    if (i % 10 === 0) {
      process.stdout.write(`\r  Generated events for ${i}/${NUM_DEVICES} devices`);
    }
  }

  console.log(`\n✅ Generated ${allEvents.length.toLocaleString()} events`);

  // Sort events by timestamp
  console.log('🔄 Sorting events by timestamp...');
  allEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Split into chunks (simulate Firehose batching)
  const CHUNK_SIZE = 10000; // Events per file
  const chunks: Event[][] = [];
  
  for (let i = 0; i < allEvents.length; i += CHUNK_SIZE) {
    chunks.push(allEvents.slice(i, i + CHUNK_SIZE));
  }

  console.log(`📦 Split into ${chunks.length} files (~${CHUNK_SIZE} events each)`);

  // Compress and upload each chunk
  console.log('🔄 Compressing and uploading to S3...');
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const compressed = await compressEvents(chunk);
    const key = `${s3Prefix}/events-${String(i + 1).padStart(3, '0')}.json.gz`;
    
    await uploadToS3(compressed, key);
    
    const progress = ((i + 1) / chunks.length * 100).toFixed(1);
    process.stdout.write(`\r  Uploaded ${i + 1}/${chunks.length} files (${progress}%)`);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`\n\n✅ Successfully uploaded ${allEvents.length.toLocaleString()} events in ${duration}s`);
  console.log(`\nS3 Location: s3://${BUCKET_NAME}/${s3Prefix}/`);
  console.log(`\nEvent Statistics:`);
  console.log(`  Total events: ${allEvents.length.toLocaleString()}`);
  console.log(`  Vehicle events: ${allEvents.filter(e => e.deviceType === 'vehicle').length.toLocaleString()}`);
  console.log(`  Handheld events: ${allEvents.filter(e => e.deviceType === 'handheld').length.toLocaleString()}`);
  console.log(`  Expected violations: ~${Math.floor(allEvents.length * 0.05).toLocaleString()} (10% of handheld events)`);
}

// Run the script
generateTestEvents()
  .then(() => {
    console.log('\n🎉 Test event generation complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed to generate test events:', error);
    process.exit(1);
  });
