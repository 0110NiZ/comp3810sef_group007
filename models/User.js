const mongoose = require('mongoose');
const { roles } = require('./constants');
const schema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true },
    role: { type: String, enum: Object.keys(roles), default: 'staff' },
    // T 的用户管理使用停用，不删除历史用户引用。
    isActive: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('User', schema);
