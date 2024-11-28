const mongoose = require('mongoose');

const commentSchema = mongoose.Schema({
    content: String,
    createdBy: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
    dataCreatedBy: {type: Date, default: Date.now()},
    comments: [{type: mongoose.Schema.Types.ObjectId, ref: 'Comment'}],
    likedBy: [{type: mongoose.Schema.Types.ObjectId, ref: 'User'}],
    parentComment: {type: mongoose.Schema.Types.ObjectId, ref: 'Comment'},
    post: {type: mongoose.Schema.Types.ObjectId, ref: 'Post'}
});

const Comment = mongoose.model('Comment', commentSchema);

module.exports = Comment;