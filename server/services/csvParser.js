const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
      return resolve([]);
    }

    fs.createReadStream(fullPath)
      .pipe(csvParser())
      .on('data', (row) => {
        const cleaned = {};
        for (const [key, value] of Object.entries(row)) {
          const k = key.trim();
          let v = value.trim();
          if (v === 'true') v = true;
          else if (v === 'false') v = false;
          else if (!isNaN(v) && v !== '') v = parseFloat(v);
          cleaned[k] = v;
        }
        // Trailing blank lines become rows with all empty fields → skip (avoids null alert_id on seed).
        const hasCell = Object.values(cleaned).some((v) => {
          if (v === true || v === false) return true;
          if (typeof v === 'number' && !Number.isNaN(v)) return true;
          if (typeof v === 'string' && v.length > 0) return true;
          return false;
        });
        if (!hasCell) return;
        results.push(cleaned);
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

async function parseAlerts(filePath) {
  const dataDir = path.resolve(__dirname, '../../data');
  return parseCSV(filePath || path.join(dataDir, 'alerts.csv'));
}

async function parseWorkflows(filePath) {
  const dataDir = path.resolve(__dirname, '../../data');
  return parseCSV(filePath || path.join(dataDir, 'workflows.csv'));
}

module.exports = { parseCSV, parseAlerts, parseWorkflows };
