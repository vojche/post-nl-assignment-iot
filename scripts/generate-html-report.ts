/**
 * HTML Report Generator
 * 
 * Generates an interactive HTML report from the JSON report with:
 * - Summary statistics
 * - Sortable violation table
 * - Map visualization of violations
 * - Charts and graphs
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';

const s3Client = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME || '';
const REPORT_KEY = process.env.REPORT_KEY || '';
const OUTPUT_FILE = process.env.OUTPUT_FILE || 'proximity-report.html';

interface ProximityViolation {
  timestamp: string;
  vehicleId: string;
  handheldId: string;
  handheldLatitude: number;
  handheldLongitude: number;
  vehicleLatitude: number;
  vehicleLongitude: number;
  distance: number;
  vehicleState: string;
}

interface DailyReport {
  reportDate: string;
  summary: {
    totalEvents: number;
    totalVehicles: number;
    totalHandhelds: number;
    totalViolations: number;
    violationRate: number;
  };
  violations: ProximityViolation[];
  metadata: {
    processingDuration: number;
    eventsProcessed: number;
    eventsSkipped: number;
  };
}

async function downloadReport(): Promise<DailyReport> {
  console.log(`📥 Downloading report from s3://${BUCKET_NAME}/${REPORT_KEY}`);
  
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: REPORT_KEY,
  });

  const response = await s3Client.send(command);
  const reportJson = await response.Body?.transformToString();
  
  if (!reportJson) {
    throw new Error('Failed to download report');
  }

  return JSON.parse(reportJson);
}

function generateHTML(report: DailyReport): string {
  const { summary, violations, metadata } = report;

  // Sort violations by distance (highest first)
  const sortedViolations = [...violations].sort((a, b) => b.distance - a.distance);

  // Get top 10 violators
  const violatorCounts = new Map<string, number>();
  violations.forEach(v => {
    violatorCounts.set(v.vehicleId, (violatorCounts.get(v.vehicleId) || 0) + 1);
  });
  const topViolators = Array.from(violatorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IoT Proximity Alert Report - ${report.reportDate}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f5f7fa;
            color: #2c3e50;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .subtitle {
            opacity: 0.9;
            font-size: 1.1em;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: transform 0.2s;
        }
        .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .stat-label {
            color: #7f8c8d;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 10px;
        }
        .stat-value {
            font-size: 2.5em;
            font-weight: bold;
            color: #2c3e50;
        }
        .stat-value.danger {
            color: #e74c3c;
        }
        .stat-value.success {
            color: #27ae60;
        }
        .section {
            background: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h2 {
            margin-bottom: 20px;
            color: #2c3e50;
            border-bottom: 3px solid #667eea;
            padding-bottom: 10px;
        }
        #map {
            height: 500px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ecf0f1;
        }
        th {
            background: #f8f9fa;
            font-weight: 600;
            color: #2c3e50;
            cursor: pointer;
            user-select: none;
        }
        th:hover {
            background: #e9ecef;
        }
        tr:hover {
            background: #f8f9fa;
        }
        .distance-high {
            color: #e74c3c;
            font-weight: bold;
        }
        .distance-medium {
            color: #f39c12;
            font-weight: bold;
        }
        .distance-low {
            color: #27ae60;
        }
        .chart-container {
            margin: 20px 0;
        }
        .bar {
            display: flex;
            align-items: center;
            margin: 10px 0;
        }
        .bar-label {
            width: 150px;
            font-size: 0.9em;
        }
        .bar-fill {
            height: 30px;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            border-radius: 5px;
            display: flex;
            align-items: center;
            padding: 0 10px;
            color: white;
            font-weight: bold;
            font-size: 0.9em;
        }
        .metadata {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 10px;
        }
        .metadata-item {
            display: flex;
            flex-direction: column;
        }
        .metadata-label {
            font-size: 0.85em;
            color: #7f8c8d;
            margin-bottom: 5px;
        }
        .leaflet-marker-icon.vehicle-marker {
            filter: hue-rotate(120deg) saturate(2);
        }
        .leaflet-marker-icon.handheld-marker {
            filter: hue-rotate(0deg) saturate(2);
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚗 IoT Proximity Alert Report</h1>
            <div class="subtitle">Date: ${report.reportDate}</div>
        </header>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Total Events</div>
                <div class="stat-value">${summary.totalEvents.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Vehicles</div>
                <div class="stat-value success">${summary.totalVehicles.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Handhelds</div>
                <div class="stat-value success">${summary.totalHandhelds.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Proximity Violations</div>
                <div class="stat-value danger">${summary.totalViolations.toLocaleString()}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Violation Rate</div>
                <div class="stat-value danger">${summary.violationRate.toFixed(2)}%</div>
            </div>
        </div>

        <div class="section">
            <h2>📍 Violation Map</h2>
            <div id="map"></div>
            <p style="color: #7f8c8d; font-size: 0.9em; margin-top: 10px;">
                🔵 Blue markers: Vehicle locations | 🔴 Red markers: Handheld locations | Dashed lines: Distance between them | Click markers/lines for details
            </p>
        </div>

        <div class="section">
            <h2>📊 Top 10 Violators</h2>
            <div class="chart-container">
                ${topViolators.map(([vehicleId, count]) => {
                    const maxCount = topViolators[0][1];
                    const percentage = (count / maxCount) * 100;
                    return `
                        <div class="bar">
                            <div class="bar-label">${vehicleId}</div>
                            <div class="bar-fill" style="width: ${percentage}%">${count} violations</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>

        <div class="section">
            <h2>📋 All Violations (Sortable)</h2>
            <p style="color: #7f8c8d; margin-bottom: 15px;">Click column headers to sort</p>
            <table id="violationsTable">
                <thead>
                    <tr>
                        <th onclick="sortTable(0)">Timestamp ↕</th>
                        <th onclick="sortTable(1)">Vehicle ID ↕</th>
                        <th onclick="sortTable(2)">Handheld ID ↕</th>
                        <th onclick="sortTable(3)">Distance (m) ↕</th>
                        <th onclick="sortTable(4)">Vehicle State ↕</th>
                        <th>Location</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedViolations.map(v => {
                        const distanceClass = v.distance > 100 ? 'distance-high' : v.distance > 75 ? 'distance-medium' : 'distance-low';
                        return `
                            <tr>
                                <td>${new Date(v.timestamp).toLocaleString()}</td>
                                <td>${v.vehicleId}</td>
                                <td>${v.handheldId}</td>
                                <td class="${distanceClass}">${v.distance.toFixed(1)}</td>
                                <td>${v.vehicleState}</td>
                                <td>
                                    ${v.vehicleLatitude && v.vehicleLongitude ? `
                                    <a href="#" onclick="showOnMap(${v.vehicleLatitude}, ${v.vehicleLongitude}); return false;">
                                        View on map
                                    </a>
                                    ` : 'N/A'}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>ℹ️ Processing Metadata</h2>
            <div class="metadata">
                <div class="metadata-item">
                    <div class="metadata-label">Processing Duration</div>
                    <div class="metadata-value">${(metadata.processingDuration / 1000).toFixed(2)}s</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Events Processed</div>
                    <div class="metadata-value">${metadata.eventsProcessed.toLocaleString()}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Events Skipped</div>
                    <div class="metadata-value">${metadata.eventsSkipped.toLocaleString()}</div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Initialize map
        const map = L.map('map').setView([52.370216, 4.895168], 12);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 19
        }).addTo(map);

        // Add violation markers
        const violations = ${JSON.stringify(sortedViolations.slice(0, 100).filter(v => v.vehicleLatitude && v.vehicleLongitude && v.handheldLatitude && v.handheldLongitude))}; // Limit to 100 for performance
        
        violations.forEach(v => {
            if (!v.vehicleLatitude || !v.vehicleLongitude || !v.handheldLatitude || !v.handheldLongitude) {
                return; // Skip invalid locations
            }
            
            // Vehicle marker (blue) - using default Leaflet marker
            const vehicleIcon = L.divIcon({
                className: 'custom-marker',
                html: '<div style="background-color: #3498db; width: 25px; height: 25px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"><div style="transform: rotate(45deg); text-align: center; line-height: 19px; color: white; font-weight: bold;">V</div></div>',
                iconSize: [25, 25],
                iconAnchor: [12, 25],
                popupAnchor: [0, -25]
            });
            
            const vehicleMarker = L.marker([v.vehicleLatitude, v.vehicleLongitude], {
                icon: vehicleIcon
            }).addTo(map);
            
            vehicleMarker.bindPopup(
                '<b>🚗 Vehicle Location</b><br>' +
                'Vehicle: ' + v.vehicleId + '<br>' +
                'Handheld: ' + v.handheldId + '<br>' +
                'Distance: <b>' + v.distance.toFixed(1) + 'm</b><br>' +
                'Time: ' + new Date(v.timestamp).toLocaleString() + '<br>' +
                'State: ' + v.vehicleState
            );
            
            // Handheld marker (red) - using default Leaflet marker
            const handheldIcon = L.divIcon({
                className: 'custom-marker',
                html: '<div style="background-color: #e74c3c; width: 25px; height: 25px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"><div style="transform: rotate(45deg); text-align: center; line-height: 19px; color: white; font-weight: bold;">H</div></div>',
                iconSize: [25, 25],
                iconAnchor: [12, 25],
                popupAnchor: [0, -25]
            });
            
            const handheldMarker = L.marker([v.handheldLatitude, v.handheldLongitude], {
                icon: handheldIcon
            }).addTo(map);
            
            handheldMarker.bindPopup(
                '<b>📱 Handheld Location</b><br>' +
                'Vehicle: ' + v.vehicleId + '<br>' +
                'Handheld: ' + v.handheldId + '<br>' +
                'Distance: <b>' + v.distance.toFixed(1) + 'm</b><br>' +
                'Time: ' + new Date(v.timestamp).toLocaleString() + '<br>' +
                'State: ' + v.vehicleState
            );
            
            // Draw line between vehicle and handheld
            const line = L.polyline(
                [[v.vehicleLatitude, v.vehicleLongitude], [v.handheldLatitude, v.handheldLongitude]],
                {
                    color: v.distance > 100 ? '#e74c3c' : v.distance > 75 ? '#f39c12' : '#e67e22',
                    weight: 2,
                    opacity: 0.6,
                    dashArray: '5, 10'
                }
            ).addTo(map);
            
            line.bindPopup(
                '<b>⚠️ Violation</b><br>' +
                'Distance: <b>' + v.distance.toFixed(1) + 'm</b><br>' +
                'Vehicle: ' + v.vehicleId + '<br>' +
                'Handheld: ' + v.handheldId
            );
        });

        // Fit map to show all markers
        if (violations.length > 0) {
            const allPoints = [];
            violations.forEach(v => {
                if (v.vehicleLatitude && v.vehicleLongitude) {
                    allPoints.push([v.vehicleLatitude, v.vehicleLongitude]);
                }
                if (v.handheldLatitude && v.handheldLongitude) {
                    allPoints.push([v.handheldLatitude, v.handheldLongitude]);
                }
            });
            if (allPoints.length > 0) {
                const bounds = L.latLngBounds(allPoints);
                map.fitBounds(bounds, { padding: [50, 50] });
            }
        }

        // Show specific location on map
        function showOnMap(lat, lng) {
            map.setView([lat, lng], 15);
        }

        // Table sorting
        function sortTable(columnIndex) {
            const table = document.getElementById('violationsTable');
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            
            const sortedRows = rows.sort((a, b) => {
                const aValue = a.cells[columnIndex].textContent.trim();
                const bValue = b.cells[columnIndex].textContent.trim();
                
                // Try numeric sort first
                const aNum = parseFloat(aValue);
                const bNum = parseFloat(bValue);
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return bNum - aNum;
                }
                
                // Fall back to string sort
                return aValue.localeCompare(bValue);
            });
            
            tbody.innerHTML = '';
            sortedRows.forEach(row => tbody.appendChild(row));
        }
    </script>
</body>
</html>`;
}

async function main() {
  try {
    if (!BUCKET_NAME || !REPORT_KEY) {
      console.error('❌ Missing required environment variables:');
      console.error('   BUCKET_NAME: S3 bucket name');
      console.error('   REPORT_KEY: S3 object key (e.g., reports/year=2024/month=01/day=15/report.json)');
      console.error('');
      console.error('Example usage:');
      console.error('   BUCKET_NAME=iot-proximity-reports-123456-acceptance \\');
      console.error('   REPORT_KEY=reports/year=2024/month=01/day=15/report.json \\');
      console.error('   npx ts-node scripts/generate-html-report.ts');
      process.exit(1);
    }

    const report = await downloadReport();
    console.log(`✅ Downloaded report with ${report.violations.length} violations`);

    const html = generateHTML(report);
    fs.writeFileSync(OUTPUT_FILE, html);

    console.log(`✅ Generated HTML report: ${OUTPUT_FILE}`);
    console.log(`📊 Summary:`);
    console.log(`   - Total Events: ${report.summary.totalEvents.toLocaleString()}`);
    console.log(`   - Total Violations: ${report.summary.totalViolations.toLocaleString()}`);
    console.log(`   - Violation Rate: ${report.summary.violationRate.toFixed(2)}%`);
    console.log('');
    console.log(`🌐 Open ${OUTPUT_FILE} in your browser to view the report`);
  } catch (error) {
    console.error('❌ Failed to generate report:', error);
    process.exit(1);
  }
}

main();
