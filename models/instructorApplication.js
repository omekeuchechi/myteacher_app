const mongoose = require('mongoose');

const instructorApplicationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  nin: {
    type: String,
    required: [true, 'NIN is required'],
    trim: true
  },
  location: {
    country: {
      type: String,
      required: [true, 'Country is required']
    },
    state: {
      type: String,
      required: [true, 'State is required']
    },
    city: {
      type: String,
      required: [true, 'City is required']
    }
  },
  linkedin: {
    type: String,
    trim: true
  },
  jobPosition: {
    type: String,
    required: [true, 'Job position is required']
  },
  preferredStartDate: {
    type: Date,
    required: [true, 'Preferred start date is required']
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true
  },
  resume: {
    data: Buffer,
    contentType: String,
    fileName: String
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'accepted', 'rejected','approved'],
    default: 'pending'
  },
  appliedAt: {
    type: Date,
    default: Date.now
  },
  reviewedAt: {
    type: Date
  },
  notes: {
    type: String,
    trim: true
  }
});

// Index for better query performance
instructorApplicationSchema.index({ email: 1, status: 1 });

// Pre-save hook to handle any data transformation if needed
instructorApplicationSchema.pre('save', function(next) {
  // You can add any pre-processing here
  next();
});

const InstructorApplication = mongoose.model('InstructorApplication', instructorApplicationSchema);

module.exports = InstructorApplication;
