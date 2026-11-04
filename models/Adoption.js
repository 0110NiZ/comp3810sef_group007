const mongoose = require('mongoose');
// 第一版每只动物只有一条有效领养记录；unique 是数据库索引，不等于业务校验。
const schema = new mongoose.Schema({
    animalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Animal', required: true, unique: true },
    adopterName: { type: String, required: true, trim: true },
    adopterPhone: { type: String, required: true, trim: true },
    remarks: { type: String, default: '', trim: true },
    registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: { type: Date, default: null }
}, { timestamps: true });
module.exports = mongoose.model('Adoption', schema);
