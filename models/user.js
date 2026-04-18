const config = require('config');
const mongoose = require('mongoose');
const Joi = require('joi');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const watchlistItemSchema = new mongoose.Schema({
    mediaId: { type: mongoose.Schema.Types.ObjectId, required: true },
    mediaType: { type: String, enum: ['movie', 'tvshow'], required: true },
    addedAt: { type: Date, default: Date.now }
}, { _id: false });

const watchHistoryItemSchema = new mongoose.Schema({
    mediaId: { type: mongoose.Schema.Types.ObjectId, required: true },
    mediaType: { type: String, enum: ['movie', 'tvshow'], required: true },
    episodeId: { type: mongoose.Schema.Types.ObjectId, default: null }, // null for movies
    progressSeconds: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    watchedAt: { type: Date, default: Date.now }
}, { _id: false });

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        minlength: 2,
        maxlength: 255,
        trim: true,
        required: true
    },
    email: {
        type: String,
        minlength: 5,
        maxlength: 255,
        unique: true,
        trim: true,
        required: true
    },
    password: {
        type: String,
        minlength: 5,
        maxlength: 1024,
        required: true
    },
    isAdmin: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false },
    profilePicUrl: { type: String, default: '' },

    // --- Access Control ---
    isBanned: { type: Boolean, default: false },
    banExpiresAt: { type: Date, default: null },    // null = permanent ban
    banReason: { type: String, default: '' },
    allowedGenres: [{                               // empty = no restriction
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Genre'
    }],

    // --- Activity ---
    watchlist: [watchlistItemSchema],
    watchHistory: [watchHistoryItemSchema],

    createdAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date }
});

userSchema.methods.generateAuthToken = function () {
    const token = jwt.sign(
        { _id: this._id, isAdmin: this.isAdmin },
        config.get('jwtPrivateKey')
    );
    return token;
};

const User = mongoose.model('User', userSchema);

function validateUser(user) {
    const schema = {
        name: Joi.string().min(2).max(255).required(),
        email: Joi.string().min(5).max(255).email().required(),
        password: Joi.string().min(5).max(255).required(),
        isAdmin: Joi.boolean(),
        isApproved: Joi.boolean()
    };
    return Joi.validate(user, schema);
}

function validateLogin(user) {
    const schema = {
        email: Joi.string().min(5).max(255).email().required(),
        password: Joi.string().min(5).max(255).required()
    };
    return Joi.validate(user, schema);
}

function validateProfileUpdate(data) {
    const schema = {
        name: Joi.string().min(2).max(255),
        password: Joi.string().min(5).max(255),
        profilePicUrl: Joi.string().uri().allow('')
    };
    return Joi.validate(data, schema);
}

async function hashPassword(password) {
    const salt = await bcrypt.genSalt(12);
    return bcrypt.hash(password, salt);
}

module.exports.User = User;
module.exports.validateUser = validateUser;
module.exports.validateLogin = validateLogin;
module.exports.validateProfileUpdate = validateProfileUpdate;
module.exports.hashPassword = hashPassword;
