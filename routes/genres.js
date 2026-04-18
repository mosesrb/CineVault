const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const validateObjectId = require('../middleware/validateObjectId');
const { Genre, validateGenre } = require('../models/genre');

// GET /api/genres — Public
router.get('/', async (req, res) => {
    const genres = await Genre.find().sort({ name: 1 });
    res.send(genres);
});

// GET /api/genres/:id
router.get('/:id', validateObjectId, async (req, res) => {
    const genre = await Genre.findById(req.params.id);
    if (!genre) return res.status(404).send('Genre not found.');
    res.send(genre);
});

// POST /api/genres — Admin
router.post('/', [auth, admin], async (req, res) => {
    const { error } = validateGenre(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const exists = await Genre.findOne({ name: new RegExp(`^${req.body.name}$`, 'i') });
    if (exists) return res.status(409).send('Genre already exists.');

    const genre = new Genre({ name: req.body.name });
    await genre.save();
    res.status(201).send(genre);
});

// PUT /api/genres/:id — Admin
router.put('/:id', [auth, admin, validateObjectId], async (req, res) => {
    const { error } = validateGenre(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const genre = await Genre.findByIdAndUpdate(
        req.params.id,
        { $set: { name: req.body.name } },
        { new: true }
    );
    if (!genre) return res.status(404).send('Genre not found.');
    res.send(genre);
});

// DELETE /api/genres/:id — Admin
router.delete('/:id', [auth, admin, validateObjectId], async (req, res) => {
    const genre = await Genre.findByIdAndDelete(req.params.id);
    if (!genre) return res.status(404).send('Genre not found.');
    res.send(genre);
});

module.exports = router;
