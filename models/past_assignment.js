const mongoose = require('mongoose');

const pastAssignmentSchema = new mongoose.Schema({
    assignmentName: { type: String, required: true },
    assignmentDescription: { type: String, required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submission: String,
    fileUrl: String, // To store the URL of the submitted file from Cloudinary
    cloudinaryPublicId: String, // To store the public_id for deletion
    submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const PastAssignment = mongoose.model('PastAssignment', pastAssignmentSchema);

module.exports = PastAssignment;
