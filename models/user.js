const mongoose = require("mongoose");

const userSchema = mongoose.Schema({
    name : {type: String, required: true},
    email : {type: String, required: true},
    password : {type: String, required: true},
    userCourse : {type: String, default: ""},
    phoneNumber : {type: String, default: ""},
    dataOfBirth : {type: String, default: ""},
    avatar : {type: String, default: ""},
    isVerified: { type: Boolean, default: false },
    verificationToken: String,
    resetToken: String,
    resetTokenExpiration: Date,
    isSuspended: { type: Boolean, default: false },
    postCreated : [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
    commentCreated : [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    commetsLiked : [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    postLinked : [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    followedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    isAdmin : {type: Boolean, default: false},
    isSuperAdmin: { type: Boolean, default: false },
    country : {type: String, default: "Nigeria"},
    city : String,
    onSite : {type: Boolean, default: false},
    createdAt: {type: Date, default: Date.now()}
});

const User = mongoose.model("User", userSchema);

module.exports = User;