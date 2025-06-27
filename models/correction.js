const mongoose = require('mongoose');

const correctionSchema = new mongoose.Schema({
    assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    submissionId: { type: mongoose.Schema.Types.ObjectId, required: true }, // Reference to the specific submission within the assignment
    score: { type: Number, required: true },
    correction: { type: String, required: true },
    correctedBy: {
        type: String,
        enum: ['lecturer', 'ai'],
        required: true
    },
    lecturer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Only if correctedBy is 'lecturer'
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for efficient querying
correctionSchema.index({ assignment: 1, student: 1, submissionId: 1 }, { unique: true });

const Correction = mongoose.model('Correction', correctionSchema);

module.exports = Correction;
