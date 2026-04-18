const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

// Configuration
const dbUri = 'mongodb://localhost/cinevault_dev';
// FFprobe duration helper

function getDuration(fullPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(fullPath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata.format.duration);
        });
    });
}

const { Library } = require('../models/library');

async function repairFallout() {
    try {
        await mongoose.connect(dbUri);
        
        // Fetch real vault root from DB
        const config = await Library.findOne();
        if (!config || !config.vaultRootPath) {
            console.error('❌ Vault config not found.');
            process.exit(1);
        }
        const vaultRoot = config.vaultRootPath;
        console.log(`📂 Vault Root: ${vaultRoot}`);

        const TVShow = mongoose.model('TVShow', new mongoose.Schema({ title: String }));
        const Episode = mongoose.model('Episode', new mongoose.Schema({ 
            showId: mongoose.Schema.Types.ObjectId, 
            runtime: Number, 
            title: String,
            vaultPath: String,
            season: Number,
            episode: Number
        }));
        
        const show = await TVShow.findOne({ title: 'Fallout' });
        if (!show) {
            console.error('❌ Fallout show not found in database.');
            process.exit(1);
        }
        
        console.log(`🔍 Found Show: ${show.title}. Repairing episodes...`);
        const eps = await Episode.find({ showId: show._id, runtime: 0 });
        
        console.log(`📈 Found ${eps.length} episodes with zero runtime.`);
        
        for (const ep of eps) {
            if (!ep.vaultPath) {
                console.warn(`⚠️ Episode "${ep.title}" has no vaultPath. Skipping.`);
                continue;
            }
            
            const fullPath = path.join(vaultRoot, ep.vaultPath);
            if (!fs.existsSync(fullPath)) {
                console.error(`❌ File not found: ${fullPath}`);
                continue;
            }
            
            try {
                const duration = await getDuration(fullPath);
                if (duration) {
                    ep.runtime = Math.round(duration);
                    await ep.save();
                    console.log(`✅ Fixed S${ep.season || '?'}E${ep.episode || '?'}: ${ep.title} -> ${ep.runtime}s`);
                }
            } catch (err) {
                console.error(`❌ Error probing ${ep.title}: ${err.message}`);
            }
        }
        
        console.log('✨ Repair complete.');
    } catch (err) {
        console.error('🔥 Fatal error:', err);
    } finally {
        mongoose.disconnect();
    }
}

repairFallout();
