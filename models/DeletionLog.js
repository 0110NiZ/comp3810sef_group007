const mongoose = require('mongoose');
// 独立保留删除审计，不随动物及关联业务记录一起删除；无普通修改/删除入口。
const schema = new mongoose.Schema({
    animalId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    animalCode: { type: String, required: true },
    appearance: { type: String, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, required: true },
    deletedFollowUps: { type: Number, required: true, min: 0 },
    deletedAdoptions: { type: Number, required: true, min: 0 }
}, { timestamps: true });
module.exports = mongoose.model('DeletionLog', schema);
