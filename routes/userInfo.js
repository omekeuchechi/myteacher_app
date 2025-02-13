const express = require('express');
const router = express.Router();
const User = require('../models/user');
const UserInfo = require('../models/user_info');
const authJs = require('../middlewares/auth');

router.post('/create', authJs, async (req, res) => {
    const userId = req.decoded.userId;

    const profileInfo = await UserInfo({
        aboutYourSelf: req.body.aboutYourSelf,
        hobbies: req.body.hobbies,
        stateOfProvidence: req.body.stateOfProvidence,
        marritaStatus: req.body.marritaStatus,
        storyImage: req.body.storyImage,
        storyVideo: req.body.storyVideo,
        state: req.body.state,
        localGovernment: req.body.localGovernment,
        createdBy: userId
    })

    try {

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).send('user not found');
        }

        const userInfo = await profileInfo.save();

        res.status(200).json({
            message: "User info added successfully",
            userInfo: userInfo
        });

    } catch (error) {
        res.status(500).json({
            message: "internal server error",
            error: error
        })
    }
});