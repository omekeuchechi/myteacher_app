const mongoose = require("mongoose");

const postSchema = mongoose.Schema({
    category : String,
    content : String,
    createdBy : [{type: mongoose.Types.ObjectId, ref: "User"}],
    dataCreated : [{type: Date, default: Date.now()}],
    likeBy : [{type: mongoose.Types.ObjectId, ref: "User"}],
    comments : [{type: mongoose.Types.ObjectId, ref: "Comment"}],
});

const Post = mongoose.model('Post', postSchema);

module.exports = Post;