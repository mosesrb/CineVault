/**
 * test_search_logic.js
 * 
 * Benchmarks the metadata search algorithm against problematic franchise titles.
 */

const { fetchMetadata } = require('../services/metadataService');

async function runTest(queryName, movieType = 'movie') {
    console.log(`\n--- Testing: "${queryName}" ---`);
    const result = await fetchMetadata(queryName, null, movieType);
    console.log(`Matched: ${result.title} (${result.year}) [ID: ${result.tmdbId}]`);
    return result;
}

async function main() {
    try {
        // Test BTTF 1
        const bttf1 = await runTest('Back to the Future I');
        if (bttf1.year === 1985) console.log('✅ PASS: BTTF I matched 1985');
        else console.log('❌ FAIL: BTTF I matched wrong year ' + bttf1.year);

        // Test BTTF 2
        const bttf2 = await runTest('Back to the Future II');
        if (bttf2.year === 1989) console.log('✅ PASS: BTTF II matched 1989');
        else console.log('❌ FAIL: BTTF II matched wrong year ' + bttf2.year);

        // Test Dumb and Dumber
        const dumb1 = await runTest('Dumb and Dumber');
        if (dumb1.year === 1994) console.log('✅ PASS: Dumb and Dumber matched 1994');
        else console.log('❌ FAIL: Dumb and Dumber matched ' + dumb1.year);

        // Test Dumb and Dumber Too
        const dumb2 = await runTest('Dumb and Dumber Too');
        if (dumb2.year === 2014) console.log('✅ PASS: Dumb and Dumber Too matched 2014');
        else console.log('❌ FAIL: Dumb and Dumber Too matched ' + dumb2.year);

    } catch (err) {
        console.error('Test failed:', err);
    }
}

main();
