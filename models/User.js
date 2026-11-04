const mongoose = require('mongoose');
const { roles } = require('./constants');
const schema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true },
    role: { type: String, enum: Object.keys(roles), default: 'staff' }
}, { timestamps: true });
module.exports = mongoose.model('User', schema);
