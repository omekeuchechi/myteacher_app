const mongoose = require("mongoose");

const userSchema = mongoose.Schema({
    name : {type: String, required: true},
    email : {type: String, required: true},
    password : {type: String, required: true},
    phoneNumber : String,
    dataOfBirth : String,
    avater : String,
    postCreated : [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
    commentCreated : [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    commetsLiked : [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    postLinked : [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
    isAdmin : {type: Boolean, default: false},
    isStaff : Boolean,
    country : String,
    city : String,
    createdAt: {type: Date, default: Date.now()}
});

const User = mongoose.model("User", userSchema);

module.exports = User;