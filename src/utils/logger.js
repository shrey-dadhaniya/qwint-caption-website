const fs = require('fs');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
const logFilePath = isProd ? path.join('/app', 'app_debug.log') : path.join(__dirname, '../../app_debug.log');

function logInfo(message, data = {}) {
    const timestamp = new Date().toISOString();
    let dataStr = '';
    try {
        dataStr = Object.keys(data).length ? JSON.stringify(data) : '';
    } catch (e) {
        dataStr = '[Circular or Unserializable Data]';
    }
    const logLine = `[INFO] ${timestamp} - ${message} ${dataStr}\n`;
    console.log(logLine.trim());
    fs.appendFileSync(logFilePath, logLine);
}

function logError(message, error = null) {
    const timestamp = new Date().toISOString();
    let errStr = '';
    if (error) {
        errStr = error.stack || error.message || String(error);
    }
    const logLine = `[ERROR] ${timestamp} - ${message} ${errStr}\n`;
    console.error(logLine.trim());
    fs.appendFileSync(logFilePath, logLine);
}

module.exports = {
    logInfo,
    logError
};
