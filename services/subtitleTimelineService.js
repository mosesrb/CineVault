const { Transform } = require('stream');
const { StringDecoder } = require('string_decoder');

const timestamp = '(?:\\d{2,}:)?\\d{2}:\\d{2}[.,]\\d{3}';
const timingLine = new RegExp(`^(${timestamp})\\s+-->\\s+(${timestamp})(.*)$`);

function milliseconds(value) {
    const parts = value.replace(',', '.').split(':').map(Number);
    const seconds = parts.pop();
    const minutes = parts.pop();
    const hours = parts.pop() || 0;
    if (![seconds, minutes, hours].every(Number.isFinite) || seconds >= 60 || minutes >= 60) {
        throw new Error('Invalid subtitle timestamp.');
    }
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function formatTimestamp(value) {
    const hours = Math.floor(value / 3600000);
    const minutes = Math.floor(value / 60000) % 60;
    const seconds = Math.floor(value / 1000) % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}

/**
 * Convert SRT/WebVTT cue blocks to WebVTT on the restarted video's local timeline.
 * Stream the entire original subtitle timeline: FFmpeg input seeking can rebase
 * an overlapping cue to its start instead of the requested absolute position.
 */
function createSubtitleTimeline({ format = 'vtt', seekSeconds = 0 } = {}) {
    if (!['srt', 'vtt'].includes(format) || !Number.isFinite(seekSeconds) || seekSeconds < 0) {
        throw new Error('Invalid subtitle timeline options.');
    }
    const offset = Math.round(seekSeconds * 1000);
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let first = true;
    const emitBlock = (output, block) => {
        const lines = block.replace(/\r/g, '').replace(/^\uFEFF/, '').split('\n');
        const index = lines.findIndex(line => timingLine.test(line));
        if (index < 0) {
            if (format === 'vtt' && block.trim()) output.push(lines.join('\n') + '\n\n');
            return;
        }
        const [, startText, endText, settings] = timingLine.exec(lines[index]);
        const start = milliseconds(startText), end = milliseconds(endText);
        if (end < start) throw new Error('Invalid subtitle cue interval.');
        if (end <= offset) return;
        lines[index] = `${formatTimestamp(Math.max(0, start - offset))} --> ${formatTimestamp(end - offset)}${settings}`;
        output.push(lines.join('\n') + '\n\n');
    };
    return new Transform({
        transform(chunk, encoding, callback) {
            try {
                if (first) {
                    if (format === 'srt') this.push('WEBVTT\n\n');
                    first = false;
                }
                pending += decoder.write(chunk);
                let match;
                while ((match = /\r?\n\r?\n/.exec(pending))) {
                    const block = pending.slice(0, match.index);
                    if (block.length > 65536) throw new Error('Subtitle cue too large.');
                    emitBlock(this, block);
                    pending = pending.slice(match.index + match[0].length);
                }
                if (pending.length > 65536) throw new Error('Subtitle cue too large.');
                callback();
            } catch (error) { callback(error); }
        },
        flush(callback) {
            try {
                pending += decoder.end();
                if (first && format === 'srt') this.push('WEBVTT\n\n');
                if (pending.trim()) emitBlock(this, pending);
                callback();
            } catch (error) { callback(error); }
        }
    });
}

module.exports = { createSubtitleTimeline };
