const express = require('express');
const router = express.Router();
const User = require('../models/user');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authJs = require('../middlewares/auth');
const sendEmail = require('../lib/sendEmail');
const multer = require('multer');
const { storage, fileFilter } = require('../middlewares/multerStorage');

const upload = multer({ storage, fileFilter });

// Register with Email Verification
router.post('/create', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const token = jwt.sign({ email }, process.env.TOKEN_SECRET_WORD, { expiresIn: '15m' });

        const verificationLink = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
        const html = `
            <h3>Email Verification</h3>
            <p>Hello ${name}, please verify your email:</p>
            <a href="${verificationLink}">${verificationLink}</a>
        `;

        await sendEmail(email, 'Verify Your Email', html);

        const user = new User({ name, email, password: hashedPassword, verificationToken: token });
        const response = await user.save();

        const viewResponse = {
            _id: response._id,
            name: response.name,
            email: response.email
        };

        res.status(201).json({
            message: "Verification email sent. Check your inbox.",
            user: viewResponse
        });
    } catch (err) {
        res.status(500).json({
            message: "Error creating user",
            error: err.message
        });
    }
});

// Email Verification Route
router.get('/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        const decoded = jwt.verify(token, process.env.TOKEN_SECRET_WORD);

        const user = await User.findOne({ email: decoded.email, verificationToken: token });
        if (!user) return res.status(400).send('Invalid or expired token');

        user.isVerified = true;
        user.verificationToken = null;
        await user.save();

        res.redirect(`${process.env.CLIENT_URL}/verify-success`);
    } catch (err) {
        res.status(400).send('Verification failed or expired');
    }
});

// Resend Verification Email
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ message: 'User not found' });
        if (user.isVerified) return res.status(400).json({ message: 'Email already verified' });

        const token = jwt.sign({ email }, process.env.TOKEN_SECRET_WORD, { expiresIn: '15m' });
        user.verificationToken = token;
        await user.save();

        const link = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
        const html = `<h3>Verify Your Email</h3><a href="${link}">${link}</a>`;

        await sendEmail(email, 'Resend Email Verification', html);

        res.status(200).json({ message: 'Verification email resent' });
    } catch (err) {
        res.status(500).json({ message: 'Error resending verification email', error: err.message });
    }
});

// Login Route
router.post('/login', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });

        if (!user) {
            return res.status(401).json('User does not exist');
        }

        if (!user.isVerified) {
            return res.status(403).json({ message: 'Email not verified' });
        }

        const result = await bcrypt.compare(req.body.password, user.password);

        if (user && result) {
            const token = jwt.sign({ userId: user._id, isAdmin: user.isAdmin }, process.env.TOKEN_SECRET_WORD, { expiresIn: '1d' });

            return res.status(200).json({
                message: "user authenticated",
                token: token,
                user,
            });
        }
    } catch (error) {
        res.status(500).json({
            message: "Internal server error",
            error: error
        });
    }
});

router.get('/', authJs, async (req, res) => {
    const isAdmin = req.decoded.isAdmin;

    if (!isAdmin) {
        return res.status(400).send("You are not an admin");
    }

    const users = await User.find();

    res.status(200).json({
        message: "Users fetched successfully",
        users: users
    });
});

router.patch('/profile', authJs, async (req, res) => {
    const userId = req.decoded.userId;
    const userInfo = req.body;

    let user = await User.findById(userId);

    if (!user) {
        return res.status(400).send("Couldn't find user");
    }

    for (propName in userInfo) {
        switch (propName) {
            case 'name':
                user.name = userInfo.name;
                break;
            case 'email':
                user.email = userInfo.email;
                break;
            case 'phoneNumber':
                user.phoneNumber = userInfo.phoneNumber;
                break;
            case 'dateOfBirth':
                user.dateOfBirth = userInfo.dateOfBirth;
                break;
            case 'avatar':
                user.avatar = userInfo.avatar;
                break;
            case 'country':
                user.country = userInfo.country;
                break;
            case 'city':
                user.city = userInfo.city;
                break;
            case 'admin':
                user.isAdmin = userInfo.admin;
                break;
            default:
                return user;
        }
    }

    try {
        const response = await user.save();
        res.status(200).json({ message: "User profile updated successfully", user: response });
    } catch (error) {
        res.status(500).json({
            message: "Something occurred could not update user profile",
            error: error
        });
    }
});

router.delete('/:userId/deleteUser', authJs, async (req, res) => {
    const userId = req.params.userId;
    const isAdmin = req.decoded.isAdmin;

    if (!isAdmin) {
        return res.status(400).send("Unauthorized, you are not an admin");
    }

    try {
        const deletedUser = await User.findByIdAndDelete(userId);

        if (!deletedUser) {
            return res.status(404).send("User does not exist");
        }

        res.status(200).json({ message: "User deleted successfully", deletedUser: deletedUser });
    } catch (error) {
        res.status(400).json({
            message: "Error occurred, user was not deleted",
            error: error
        });
    }
});

router.patch('/profile_image', authJs, upload.single('avatar'), async (req, res) => {
    const userId = req.decoded.userId;
    const userInfo = req.body;

    let user = await User.findById(userId);

    if (!user) {
        return res.status(400).send("Couldn't find user");
    }

    for (propName in userInfo) {
        switch (propName) {
            case 'avater':
                user.avater = userInfo.avater || userInfo.avatar;
                break;
            default:
                return user;
        }
    }

    try {
        const response = await user.save();
        res.status(200).json({ message: "User profile image updated successfully", user: response });
    } catch (error) {
        res.status(500).json({
            message: "Something occurred could not update user profile",
            error: error
        });
    }
});

module.exports = router;