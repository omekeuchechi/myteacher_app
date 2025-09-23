const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const reactionSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reaction: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5 // For emojis or short reaction codes
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const messageSchema = new Schema({
  roomId: {
    type: String,
    required: true,
    index: true
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  sender: {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    avatar: String
  },
  type: {
    type: String,
    enum: ['text', 'system', 'announcement'],
    default: 'text'
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'deleted'],
    default: 'sent'
  },
  metadata: {
    isEdited: {
      type: Boolean,
      default: false
    },
    isDeleted: {
      type: Boolean,
      default: false
    },
    deletedAt: Date,
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    editedAt: Date,
    originalContent: String
  },
  reactions: [reactionSchema],
  mentions: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  replyTo: {
    type: Schema.Types.ObjectId,
    ref: 'Message'
  },
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'video', 'file', 'audio'],
      required: true
    },
    url: {
      type: String,
      required: true
    },
    name: String,
    size: Number,
    mimeType: String,
    thumbnail: String
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
messageSchema.index({ roomId: 1, createdAt: -1 });
messageSchema.index({ 'sender.userId': 1 });
messageSchema.index({ 'metadata.isDeleted': 1 });

// Virtual for message URL
messageSchema.virtual('url').get(function() {
  return `/messages/${this._id}`;
});

// Pre-save hook to handle message updates
messageSchema.pre('save', function(next) {
  if (this.isModified('content') && this.content !== this.originalContent) {
    this.metadata.originalContent = this.originalContent || this.content;
    this.metadata.isEdited = true;
    this.metadata.editedAt = new Date();
  }
  next();
});

// Static method to get messages for a room with pagination
messageSchema.statics.getRoomMessages = async function(roomId, { limit = 50, before } = {}) {
  const query = { roomId, 'metadata.isDeleted': false };
  
  if (before) {
    query.createdAt = { $lt: new Date(before) };
  }

  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .lean();
};

// Instance method to add a reaction
messageSchema.methods.addReaction = function(userId, reaction) {
  const existingReactionIndex = this.reactions.findIndex(
    r => r.userId.toString() === userId.toString()
  );

  if (existingReactionIndex >= 0) {
    // Update existing reaction
    if (this.reactions[existingReactionIndex].reaction === reaction) {
      // Remove reaction if it's the same
      this.reactions.splice(existingReactionIndex, 1);
    } else {
      // Update reaction
      this.reactions[existingReactionIndex].reaction = reaction;
      this.reactions[existingReactionIndex].timestamp = new Date();
    }
  } else {
    // Add new reaction
    this.reactions.push({
      userId,
      reaction,
      timestamp: new Date()
    });
  }

  return this.save();
};

// Soft delete method
messageSchema.methods.softDelete = function(userId) {
  this.metadata.isDeleted = true;
  this.metadata.deletedAt = new Date();
  this.metadata.deletedBy = userId;
  return this.save();
};

// Restore soft-deleted message
messageSchema.methods.restore = function() {
  this.metadata.isDeleted = false;
  this.metadata.deletedAt = undefined;
  this.metadata.deletedBy = undefined;
  return this.save();
};

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
