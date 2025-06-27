const { default: mongoose } = require("mongoose");

const assignmentSchema = mongoose.Schema({
    assignmentName: { type: String, required: true },
    assignmentDescription: { type: String, required: true },
    template: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', required: true },
    submitType: { type: String, required: true, enum: ['text', 'file', 'both'] },
    expiringDate: { type: Date, required: true },
    submissions: [{
        student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        submission: String,
        fileUrl: String,
        cloudinaryPublicId: String, // To store the public_id for deletion
        submittedAt: { type: Date, default: Date.now },
        score: { type: Number, default: 0 },
        graded: { type: Boolean, default: false }
    }],
    status: { type: String, enum: ['active', 'expired'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for better query performance
assignmentSchema.index({ targetBatch: 1, status: 1 });
assignmentSchema.index({ createdBy: 1 });
assignmentSchema.index({ expiringDate: 1 });

// Pre-save hook to update status based on expiringDate
assignmentSchema.pre('save', function(next) {
    if (this.isModified('expiringDate') && this.expiringDate < new Date()) {
        this.status = 'expired';
    }
    next();
});

const Assignment = mongoose.model('Assignment', assignmentSchema);

module.exports = Assignment;