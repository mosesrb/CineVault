const fs = require('fs');
const path = require('path');

function parseEnvironment(contents) {
    const values = {};
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const separator = line.indexOf('=');
        if (separator <= 0) continue;

        const key = line.slice(0, separator).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

function loadEnvironment(filePath = path.resolve(__dirname, '..', '.env'), target = process.env) {
    if (!fs.existsSync(filePath)) return {};
    const values = parseEnvironment(fs.readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
        if (target[key] === undefined) target[key] = value;
    }
    return values;
}

module.exports = loadEnvironment;
module.exports.parseEnvironment = parseEnvironment;
