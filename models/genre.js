const mongoose = require('mongoose');
const Joi = require('joi');

const genreSchema = new mongoose.Schema({
    name: {
        type: String,
        minlength: 2,
        maxlength: 50,
        trim: true,
        required: true
    },
    slug: {
        type: String,
        minlength: 2,
        maxlength: 60,
        trim: true,
        unique: true,
        lowercase: true
    }
});

// Auto-generate slug from name before saving
genreSchema.pre('save', function (next) {
    if (this.isModified('name') || !this.slug) {
        this.slug = this.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    }
    next();
});

const Genre = mongoose.model('Genre', genreSchema);

function validateGenre(genre) {
    const schema = {
        name: Joi.string().min(2).max(50).required(),
        slug: Joi.string().min(2).max(60).lowercase()
    };
    return Joi.validate(genre, schema);
}

module.exports.Genre = Genre;
module.exports.genreSchema = genreSchema;
module.exports.validateGenre = validateGenre;
