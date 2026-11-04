const mongoose = require('mongoose');
const { animalTypes, rescueStatuses, adoptionStatuses } = require('./constants');
const ref = (model) => ({ type: mongoose.Schema.Types.ObjectId, ref: model, default: null });
// 此处只定义字段和基础类型，不执行跨记录业务状态校验。
const schema = new mongoose.Schema({
    animalCode: { type: String, required: true, unique: true, trim: true },
    animalType: { type: String, enum: Object.keys(animalTypes), required: true },
    appearance: { type: String, required: true, trim: true },
    foundLocation: { type: String, required: true, trim: true },
    healthStatus: { type: String, required: true, trim: true },
    contactName: { type: String, required: true, trim: true },
    contactPhone: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rescueStatus: { type: String, enum: Object.keys(rescueStatuses), default: 'pending' },
    assignedTo: ref('User'),
    placementLocation: { type: String, default: '', trim: true },
    adoptionStatus: { type: String, enum: Object.keys(adoptionStatuses), default: 'not_open' },
    closedAt: { type: Date, default: null },
    closedBy: ref('User')
}, { timestamps: true });
module.exports = mongoose.model('Animal', schema);
