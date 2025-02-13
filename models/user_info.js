const mongoose = require('mongoose');

const userInfoSchema = mongoose.Schema({
    aboutYourSelf: {type: String, default: " a tech guru 🖥💻 looking forward to update once's self "},
    hobbies: {type: String, default: " coding 🖥, playing football ⚽, dancing 🤸‍♀️ "},
    stateOfProvidence: {type: String, default: "New york"},
    marritaStatus: String,
    storyImage: String,
    storyVideo: String,
    state: {type: String, default: "New york"},
    localGovernment: {type: String, default: "New york"},
    createdBy: {type: mongoose.Types.ObjectId, ref: 'User'},
    createdAt: {type: Date, default: Date.now()}
})

const UserInfo = mongoose.model("UserInfo", userInfoSchema);

module.exports = UserInfo;