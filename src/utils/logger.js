'use strict';

const fs = require('fs');
const path = require('path');

// In prod the app runs from /app inside the container; locally resolve from src/utils/
const isProd = process.env.NODE_ENV === 'production';
// const logFilePath = isProd
//     ? path.join('/app', 'app_debug.log')
//     : path.join(__dirname, '../../app_debug.log');

const logFilePath = path.join(__dirname, '../../app_debug.log');

// Colour codes for terminal output
const COLOURS = {
    reset: '\x1b[0m',
    grey: '\x1b[90m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m'
};

const LEVEL_COLOUR = {
    DEBUG: COLOURS.grey,
    HTTP: COLOURS.cyan,
    INFO: COLOURS.green,
    WARN: COLOURS.yellow,
    ERROR: COLOURS.red
};

// ─────────────────────────────────────────────────────────────
// Core writer
// ─────────────────────────────────────────────────────────────
function _write(level, message, extra = null) {
    const ts = new Date().toISOString();

    // Build extra string safely
    let extraStr = '';
    if (extra !== null && extra !== undefined) {
        if (extra instanceof Error) {
            extraStr = extra.stack || extra.message || String(extra);
        } else if (typeof extra === 'object') {
            try { extraStr = JSON.stringify(extra); } catch (_) { extraStr = '[Unserializable]'; }
        } else {
            extraStr = String(extra);
        }
    }

    // ── File line (plain text, easy to grep) ──
    const fileLine = `[${level}] ${ts} - ${message}${extraStr ? ' | ' + extraStr : ''}\n`;
    try {
        fs.appendFileSync(logFilePath, fileLine);
    } catch (_) { /* never crash the app on log failure */ }

    // ── Console line (coloured) ──
    const col = LEVEL_COLOUR[level] || COLOURS.reset;
    const consoleLine = `${COLOURS.grey}${ts}${COLOURS.reset} ${col}[${level}]${COLOURS.reset} ${message}${extraStr ? ' ' + extraStr : ''}`;
    if (level === 'ERROR') {
        console.error(consoleLine);
    } else if (level === 'WARN') {
        console.warn(consoleLine);
    } else {
        console.log(consoleLine);
    }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────
function logDebug(message, data) { _write('DEBUG', message, data); }
function logHttp(message, data) { _write('HTTP', message, data); }
function logInfo(message, data) { _write('INFO', message, data); }
function logWarn(message, data) { _write('WARN', message, data); }
function logError(message, error) { _write('ERROR', message, error); }

// morgan-compatible stream  →  app.use(morgan('combined', { stream: morganStream }))
const morganStream = {
    write(message) {
        _write('HTTP', message.trimEnd());
    }
};

module.exports = { logDebug, logHttp, logInfo, logWarn, logError, morganStream };
