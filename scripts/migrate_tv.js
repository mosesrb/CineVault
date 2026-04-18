const mongoose = require('mongoose');

async function consolidateTV() {
    try {
        await mongoose.connect('mongodb://localhost:27017/cinevault_dev');
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const hasLegacy = collections.some(c => c.name === 'tv_shows');

        if (!hasLegacy) {
            console.log('No legacy "tv_shows" collection found. Skipping.');
            process.exit(0);
        }

        console.log('Migrating "tv_shows" into "tvshows"...');
        const legacyDocs = await db.collection('tv_shows').find().toArray();
        console.log(`Found ${legacyDocs.length} documents in legacy collection.`);

        for (const doc of legacyDocs) {
            // Check if already exists in target
            const exists = await db.collection('tvshows').findOne({ title: doc.title, year: doc.year });
            if (!exists) {
                await db.collection('tvshows').insertOne(doc);
                console.log(`Migrated: ${doc.title}`);
            } else {
                console.log(`Skipped (already exists): ${doc.title}`);
            }
        }

        console.log('Migration complete. Deleting legacy collection.');
        await db.collection('tv_shows').drop();
        
        console.log('Done.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

consolidateTV();
