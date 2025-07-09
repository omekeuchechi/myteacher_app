const mongoose = require('mongoose');
const Lecture = require('./lecture');

const videoSchema = new mongoose.Schema({
  lecture: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture',
    required: true,
    validate: {
      validator: async function(value) {
        const lecture = await Lecture.findById(value);
        if (!lecture) return false;
        return lecture.expiringDate > new Date();
      },
      message: 'The referenced lecture has expired.'
    }
  },
  videoLink: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Comments on the video (only if the admin has created the video)
  comment: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      text: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
edited: { type: Boolean, default: false }
    }
  ],
  // Replies to comments on the video
  replyComment: [
    {
      commentId: { type: mongoose.Schema.Types.ObjectId, required: true }, // references a comment in the 'comment' array
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      text: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
edited: { type: Boolean, default: false }
    }
  ]
}, { timestamps: true });

const Video = mongoose.model('Video', videoSchema);

module.exports = Video;
