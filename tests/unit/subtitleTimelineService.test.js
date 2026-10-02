const { Readable } = require('stream');
const { createSubtitleTimeline } = require('../../services/subtitleTimelineService');

async function convert(text, options, chunkSize = 7) {
    const bytes = Buffer.from(text);
    const chunks = [];
    for (let i = 0; i < bytes.length; i += chunkSize) chunks.push(bytes.subarray(i, i + chunkSize));
    let result = '';
    const stream = Readable.from(chunks).pipe(createSubtitleTimeline(options));
    for await (const chunk of stream) result += chunk.toString();
    return result;
}

describe('subtitle timeline normalization', () => {
    it('converts split UTF-8/CRLF SRT cues to browser WebVTT', async () => {
        const result = await convert('\uFEFF1\r\n00:00:01,125 --> 00:00:05,250\r\nSynthetic café\r\n\r\n', { format: 'srt' }, 1);
        expect(result).toBe('WEBVTT\n\n1\n00:00:01.125 --> 00:00:05.250\nSynthetic café\n\n');
    });

    it('subtracts the exact seek from overlapping cues, not the first cue start', async () => {
        const text = 'WEBVTT\n\n00:00.000 --> 00:05.000\nOld\n\n00:10.000 --> 00:30.000 align:start\nOverlap\n\n00:30.000 --> 01:00.000\nFuture';
        const result = await convert(text, { seekSeconds: 18 });
        expect(result).not.toContain('Old');
        expect(result).toContain('00:00:00.000 --> 00:00:12.000 align:start\nOverlap');
        expect(result).toContain('00:00:12.000 --> 00:00:42.000\nFuture');
        expect(result).toMatch(/^WEBVTT\n\n/);
    });

    it('preserves VTT identifiers, header metadata, NOTE, STYLE and cue settings', async () => {
        const text = 'WEBVTT synthetic\n\nNOTE synthetic note\n\nSTYLE\n::cue { color: lime; }\n\ncaption-id\n01:00:00.001 --> 01:00:02.000 line:90%\nSynthetic';
        const result = await convert(text, { seekSeconds: 3600 });
        expect(result).toContain('WEBVTT synthetic\n\nNOTE synthetic note');
        expect(result).toContain('STYLE\n::cue { color: lime; }');
        expect(result).toContain('caption-id\n00:00:00.001 --> 00:00:02.000 line:90%');
    });

    it('drops cues ending exactly at the offset and supports fractional seeks', async () => {
        const result = await convert('1\n00:00:00,000 --> 00:00:05,500\nOld\n\n2\n00:00:05,500 --> 00:00:07,250\nNext', { format: 'srt', seekSeconds: 5.5 });
        expect(result).not.toContain('Old');
        expect(result).toContain('00:00:00.000 --> 00:00:01.750\nNext');
    });

    it('produces a valid header for empty SRT or when all cues precede the seek', async () => {
        expect(await convert('', { format: 'srt' })).toBe('WEBVTT\n\n');
        expect(await convert('1\n00:00:00,000 --> 00:00:01,000\nOld', { format: 'srt', seekSeconds: 2 })).toBe('WEBVTT\n\n');
    });

    it.each([-1, NaN, Infinity])('rejects invalid seek %s', seekSeconds => {
        expect(() => createSubtitleTimeline({ seekSeconds })).toThrow('Invalid subtitle timeline options.');
    });

    it('rejects malformed cue intervals and oversized blocks without buffering entire files', async () => {
        await expect(convert('WEBVTT\n\n00:60.000 --> 01:02.000\nBad', {})).rejects.toThrow('Invalid subtitle timestamp.');
        await expect(convert('WEBVTT\n\n00:05.000 --> 00:01.000\nBad', {})).rejects.toThrow('Invalid subtitle cue interval.');
        await expect(convert('x'.repeat(65537), {}, 32768)).rejects.toThrow('Subtitle cue too large.');
    });
});
