/**
 * transcoderService.js
 * 
 * Handles on-the-fly transcoding and remuxing for incompatible media formats.
 */

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

/**
 * Probes a file to extract stream information (audio tracks, etc).
 */
function getMediaMetadata(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata);
        });
    });
}

/**
 * Creates a transcoded stream for the given file starting at a specific time.
 */
function createTranscodeStream(filePath, startTime = 0, audioIndex = 0) {
    const command = ffmpeg(filePath);

    if (startTime > 0) {
        command.seekInput(startTime);
    }

    command.addOption('-map', '0:v:0');
    command.addOption('-map', `0:a:${audioIndex}`);

    command
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioChannels(2)
        .format('mp4')
        .outputOptions([
            '-movflags frag_keyframe+empty_moov+default_base_moof+faststart',
            '-pix_fmt yuv420p',
            '-profile:v main',
            '-level 3.1',
            '-g 48',
            '-bf 0',
            '-preset superfast',
            '-tune zerolatency',
            '-crf 26',
            '-threads 0',
            '-avoid_negative_ts make_zero',
            '-reset_timestamps 1',
            '-map_metadata -1'
        ])
        .on('start', (cmd) => {
            console.log('FFmpeg Pro Stream started: ' + cmd);
        })
        .on('error', (err, stdout, stderr) => {
            if (err.message && (err.message.includes('SIGKILL') || err.message.includes('Output stream closed'))) {
                return;
            }
            console.error('--- FFmpeg Error Report ---');
            console.error('Message:', err.message);
            console.error('StdErr:', stderr);
            console.error('--------------------------');
        });

    return command;
}

/**
 * Fast remuxing attempt (copying codecs if compatible).
 */
function createRemuxStream(filePath) {
    return ffmpeg(filePath)
        .videoCodec('copy')
        .audioCodec('copy')
        .format('mp4')
        .outputOptions([
            '-movflags frag_keyframe+empty_moov'
        ])
        .on('start', (cmd) => {
            console.log('FFmpeg Remux started with: ' + cmd);
        })
        .on('error', (err) => {
            if (err.message && err.message.includes('SIGKILL')) return;
            console.error('FFmpeg Remux Error:', err.message);
        });
}

/**
 * Creates an HLS stream (m3u8 + ts segments).
 *
 * On Windows, path.join() produces backslashes but FFmpeg requires forward
 * slashes for all paths. We normalize every path passed to FFmpeg.
 */
function createHlsStream(filePath, outputDir) {
    const toFFmpegPath = (p) => p.replace(/\\/g, '/');

    const manifestPath = path.join(outputDir, 'master.m3u8');
    const manifestPathFF = toFFmpegPath(manifestPath);
    const segmentPatternFF = toFFmpegPath(path.join(outputDir, 'seg_%03d.ts'));
    const inputPathFF = toFFmpegPath(filePath);

    return ffmpeg(inputPathFF)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
            '-f hls',
            '-hls_time 6',
            '-hls_playlist_type vod',
            '-hls_segment_filename', segmentPatternFF,
            '-hls_flags independent_segments',
            '-hls_base_url', '',
            '-map 0:v:0',
            '-map 0:a?',
            '-pix_fmt yuv420p',
            '-preset superfast',
            '-tune zerolatency',
            '-crf 26',
            '-threads 0'
        ])
        .on('start', (cmd) => {
            console.log('🚀 HLS Engine: ' + cmd);
            const debugLog = path.join(outputDir, 'ffmpeg_debug.log');
            fs.writeFileSync(debugLog, `START: ${new Date().toISOString()}\nCMD: ${cmd}\n\n`);
        })
        .on('stderr', (stderrLine) => {
            const debugLog = path.join(outputDir, 'ffmpeg_debug.log');
            fs.appendFileSync(debugLog, stderrLine + '\n');
        })
        .on('error', (err) => {
            if (err.message && (err.message.includes('SIGKILL') || err.message.includes('Output stream closed'))) {
                return;
            }
            console.error('❌ FFmpeg HLS Error:', err.message);
            const debugLog = path.join(outputDir, 'ffmpeg_debug.log');
            fs.appendFileSync(debugLog, `\n\n❌ ERROR: ${err.message}\n`);
        })
        .save(manifestPathFF);
}

module.exports = {
    getMediaMetadata,
    createTranscodeStream,
    createRemuxStream,
    createHlsStream
};
