const mongoose = require('mongoose');
const schema = new mongoose.Schema(
    {
        animalId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Animal',
            required: true
        },
        content: {
            type: String,
            required: true,
            trim: true
        },
        nextFollowUpDate: {
            type: String,
            default: null
        },
        recordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        }
    },
    {
        timestamps: true
    }
);
schema.index({
    animalId: 1,
    createdAt: -1
});
module.exports = mongoose.model('FollowUp', schema);
