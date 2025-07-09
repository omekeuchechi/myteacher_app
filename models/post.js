const mongoose = require("mongoose");

const postSchema = mongoose.Schema({
    images: [{
        url: { type: String, required: true },
        publicId: { type: String, required: true }, // For cloudinary or similar services
        width: Number,
        height: Number,
        format: String
    }],
    category: {
        type: String,
        required: [true, 'Category is required'],
        trim: true
    },
    content: {
        type: String,
        required: [true, 'Content is required'],
        trim: true
    },
    createdBy: {
        type: mongoose.Types.ObjectId,
        ref: "User",
        required: true
    },
    likes: [{
        user: {
            type: mongoose.Types.ObjectId,
            ref: "User"
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }],
    comments: [{
        type: mongoose.Types.ObjectId,
        ref: "Comment"
    }],
    tags: [{
        type: String,
        trim: true
    }],
    isArchived: {
        type: Boolean,
        default: false
    },
    viewCount: {
        type: Number,
        default: 0
    },
    shareCount: {
        type: Number,
        default: 0
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            default: [0, 0]
        },
        name: String
    }
}, {
    timestamps: true, // Adds createdAt and updatedAt automatically
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better query performance
postSchema.index({ createdAt: -1 }); // For sorting by newest
postSchema.index({ likes: -1 }); // For sorting by popularity
postSchema.index({ 'location.coordinates': '2dsphere' }); // For geospatial queries

// Virtual for like count
postSchema.virtual('likeCount').get(function() {
    return this.likes.length;
});

// Virtual for comment count
postSchema.virtual('commentCount', {
    ref: 'Comment',
    localField: 'comments',
    foreignField: '_id',
    count: true
});

// Middleware to update timestamps
postSchema.pre('save', function(next) {
    if (this.isModified('content')) {
        this.updatedAt = Date.now();
    }
    next();
});

const Post = mongoose.model('Post', postSchema);

module.exports = Post;