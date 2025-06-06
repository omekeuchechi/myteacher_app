const mongoose = require("mongoose");

const enrollmentSchema = new mongoose.Schema({
  userId: String,
  courseId: String,
  enrolledAt: { type: Date, default: Date.now },
  expiryDate: Date,
});

const Enrollment = mongoose.model('Enrollment', enrollmentSchema);

module.exports = Enrollment;