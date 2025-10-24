const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
  title: { type: String, required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  startTime: { type: Date, required: true },
  platform: { type: String, required: true, default: 'Zoom' },
  zoomLink: { type: String, required: true },
  topics: [{ type: String, required: true }],
  jitsiPassword: String,
  isVerified: { type: Boolean, default: false },
  verificationToken: String,
  lecturesListed: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  studentsEnrolled: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  days: [{
    type: String,
    required: true,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    message: '{VALUE} is not a valid day of the week. Please use full day names (e.g., Monday, Tuesday, etc.)'
  }],
  createdAt: {type: Date, default: Date.now()},
  expiringDate: { type: Date, required: true } // <-- Added expiring date
}, { timestamps: true });

const Lecture = mongoose.model('Lecture', lectureSchema);

module.exports = Lecture;