const mongoose = require('mongoose');

const duplicateSchema = new mongoose.Schema({
    originalMediaId: { 
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'originalMatchModel'
    },
    originalMatchModel: {
        type: String,
        required: true,
        enum: ['Movie', 'Episode']
    },
    vaultPath: {
        type: String,
        required: true
    },
    hash: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number
    },
    addedAt: {
        type: Date,
        default: Date.now
    }
});

const Duplicate = mongoose.model('Duplicate', duplicateSchema);
exports.Duplicate = Duplicate;
