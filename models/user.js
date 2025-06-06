const mongoose = require("mongoose");

const userSchema = mongoose.Schema({
    name : {type: String, required: true},
    email : {type: String, required: true},
    password : {type: String, required: true},
    phoneNumber : String,
    dataOfBirth : String,
    avater : String,
    isVerified: { type: Boolean, default: false },
    verificationToken: String,
    postCreated : [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
    commentCreated : [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    commetsLiked : [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    postLinked : [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
    isAdmin : {type: Boolean, default: false},
    country : {type: String, default: "United States of America"},
    city : String,
    createdAt: {type: Date, default: Date.now()}
});

const User = mongoose.model("User", userSchema);

module.exports = User;