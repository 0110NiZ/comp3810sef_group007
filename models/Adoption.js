const mongoose = require('mongoose');
// 取消历史保留；同一动物至多一条未取消记录（包含已完成的记录）。
const schema = new mongoose.Schema({
    animalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Animal', required: true },
    adopterName: { type: String, required: true, trim: true, maxlength: 80 },
    adopterPhone: { type: String, required: true, trim: true, maxlength: 30 },
    remarks: { type: String, default: '', trim: true, maxlength: 2000 },
    registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancellationReason: { type: String, default: '', trim: true, maxlength: 1000 }
}, { timestamps: true });
schema.index({ animalId: 1 }, { name: 'one_current_adoption', unique: true, partialFilterExpression: { cancelledAt: null } });
module.exports = mongoose.model('Adoption', schema);
