const mongoose = require('mongoose');

const requestPrivateTutorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    trim: true
  },
  goals: {
    type: String,
    required: [true, 'Learning goals are required'],
    trim: true,
    default: "Passionate to learn"
  },
  status: {
    type: String,
    enum: ['pending', 'contacted', 'completed'],
    default: 'pending'
  }
}, {timestamps: true});

module.exports = mongoose.model('RequestPrivateTutor', requestPrivateTutorSchema);