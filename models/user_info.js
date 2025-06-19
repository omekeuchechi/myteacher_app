const mongoose = require('mongoose');

const userInfoSchema = new mongoose.Schema({
    aboutYourSelf: {
        type: String,
        trim: true
    },
    hobbies: {
        type: String,
        trim: true
    },
    marritaStatus: {
        type: String,
        trim: true
    },
    storyImage: {
        type: String,
        trim: true
    },
    storyVideo: {
        type: String,
        trim: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        // Ensures one-to-one relationship
        unique: true 
    },
    address: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('userInfo', userInfoSchema);
