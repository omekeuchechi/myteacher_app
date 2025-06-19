const express = require('express');
const router = express.Router();
const User = require('../models/user');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authJs = require('../middlewares/auth');
const passport = require('passport');
const sendEmail = require('../lib/sendEmail');
const path = require('path');
const axios = require('axios');
const { pushDashboardStats } = require('./admin');
const mime = require('mime-types');
const Pusher = require('pusher');
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

// Cloudinary setup
const cloudinary = require('cloudinary').v2;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Cloudinary upload helper
async function uploadBufferToCloudinary(buffer, filename, mimetype) {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
            {
                resource_type: 'image',
                public_id: `avatars/${filename}`,
                overwrite: true,
                folder: 'avatars',
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result.secure_url);
            }
        ).end(buffer);
    });
}

// Register with Email Verification
router.post('/create', async (req, res) => {
    try {
        const { name, email, password, userCourse } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: "Name, email, and password are required" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const token = jwt.sign({ email }, process.env.TOKEN_SECRET_WORD, { expiresIn: '15m' });

        const verificationLink = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Verify Your Email</h2>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                Please verify your email address to complete your account setup.
                This link will expire in 15 minutes.
              </p>
              
              <div style="text-align: center;">
                <a href="${verificationLink}" 
                   style="display: inline-block; background-color: #3498db; color: white; 
                          padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                  Verify Email Now
                </a>
              </div>
            </div>
            
            <p style="text-align: center; color: #7f8c8d; font-size: 14px;">
              Or copy this link: <span style="word-break: break-all;">${verificationLink}</span>
            </p>
            
            <p style="font-size: 12px; color: #95a5a6; text-align: center; margin-top: 30px;">
              If you didn't request this, please ignore this email.
            </p>
          </div>
        `;

        await sendEmail(email, 'Verify Your Email', html);

        const user = new User({ name, email, password: hashedPassword, userCourse, verificationToken: token, isVerified: false });
        const response = await user.save();
        await pushDashboardStats();

        const viewResponse = {
            _id: response._id,
            name: response.name,
            email: response.email,
            userCourse: response.userCourse,
        };

        // Pusher event: user created
        pusher.trigger('user', 'created', { user: viewResponse });
        return res.status(201).json({
            message: "Verification email sent. Check your inbox.",
            user: viewResponse
        });
    } catch (err) {
        return res.status(500).json({
            message: "Error creating user",
            error: err.message
        });
    }
});

// Email verification route
router.get('/verify-email', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.status(400).json({ success: false, message: 'Token is required' });
        }
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.TOKEN_SECRET_WORD);
        } catch (err) {
            // Instead of error, send a generic message
            return res.json({ success: true, message: 'This verification link is invalid or has already been used. If your email is verified, you can log in.' });
        }

        const user = await User.findOne({ email: decoded.email });
        if (!user) {
            return res.json({ success: true, message: 'This verification link is invalid or has already been used. If your email is verified, you can log in.' });
        }

        if (user.isVerified) {
            return res.json({ success: true, message: 'Your email is already verified. You can log in.' });
        }

        if (user.verificationToken !== token) {
            return res.json({ success: true, message: 'This verification link is invalid or has already been used. If your email is verified, you can log in.' });
        }

        // Mark user as verified
        user.isVerified = true;
        user.verificationToken = null;
        await user.save();
        // await pushDashboardStats();

        // Send confirmation email with a link to proceed or login
        const verificationLink = `${process.env.CLIENT_URL}/login`;
        const htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Email Verified</h2>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3 style="color: #27ae60; margin-top: 0;">Congratulations!</h3>
              <p style="font-size: 16px; margin-bottom: 0;">Your email has been verified successfully.</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationLink}" 
                 style="display: inline-block; background-color: #3498db; color: white; 
                        padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                Log In Now
              </a>
            </div>
            
            <p style="text-align: center; color: #7f8c8d; font-size: 14px;">
              Or copy this link: <span style="word-break: break-all;">${verificationLink}</span>
            </p>
          </div>
        `;

        await sendEmail(user.email, 'Your Email is Verified', htmlContent);

        res.json({ success: true, message: 'Email verified successfully' });

    } catch (err) {
        // Always return a generic message
        res.json({ success: true, message: 'This verification link is invalid or has already been used. If your email is verified, you can log in.' });
    }
});


// Resend Verification Email with link
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.isVerified) return res.status(400).json({ success: false, message: 'Email already verified' });

        const token = jwt.sign({ email }, process.env.TOKEN_SECRET_WORD, { expiresIn: '15m' });
        user.verificationToken = token;
        await user.save();
        // await pushDashboardStats();

        const verificationLink = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Verify Your Email</h2>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                Please verify your email address to complete your account setup.
                This link will expire in 15 minutes.
              </p>
              
              <div style="text-align: center;">
                <a href="${verificationLink}" 
                   style="display: inline-block; background-color: #3498db; color: white; 
                          padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                  Verify Email Now
                </a>
              </div>
            </div>
            
            <p style="text-align: center; color: #7f8c8d; font-size: 14px;">
              Or copy this link: <span style="word-break: break-all;">${verificationLink}</span>
            </p>
            
            <p style="font-size: 12px; color: #95a5a6; text-align: center; margin-top: 30px;">
              If you didn't request this, please ignore this email.
            </p>
          </div>
        `;

        await sendEmail(email, 'Email Verification', html);

        return res.json({ success: true, message: 'Verification email sent' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Error', error: err.message });
    }
});

// Login Route
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(401).json({ message: 'User does not exist' });
        }

        if (!user.isVerified) {
            return res.status(403).json({ message: 'Email not verified' });
        }

        const result = await bcrypt.compare(password, user.password);

        if (result) {
            const token = jwt.sign(
                { userId: user._id, isAdmin: user.isAdmin, isSuperAdmin: user.isSuperAdmin },
                process.env.TOKEN_SECRET_WORD,
                { expiresIn: '1d' }
            );

            return res.status(200).json({
                message: "User authenticated",
                token: token,
                user,
            });
        } else {
            return res.status(401).json({ message: "Invalid credentials" });
        }
    } catch (error) {
        return res.status(500).json({
            message: "Internal server error",
            error: error.message
        });
    }
});

// Get all users (admin only)
router.get('/', authJs, async (req, res) => {
    const isAdmin = req.decoded && req.decoded.isAdmin;

    if (!isAdmin) {
        return res.status(403).send("You are not an admin");
    }

    try {
        const users = await User.find();
        return res.status(200).json({
            message: "Users fetched successfully",
            users: users
        });
    } catch (error) {
        return res.status(500).json({ message: "Error fetching users", error: error.message });
    }
});

// Update user profile
router.patch('/profile', authJs, async (req, res) => {
    const userId = req.decoded && req.decoded.userId;
    const userInfo = req.body;

    let user = await User.findById(userId);

    if (!user) {
        return res.status(404).send("Couldn't find user");
    }

    // Prevent update if user signed up with Google
    if (user.googleId) {
        return res.status(403).json({ message: "Profile update not allowed for Google-authenticated users" });
    }

    for (let propName in userInfo) {
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
                user.avatar = userInfo.avatar || userInfo.avater;
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
                // Ignore unknown fields
                break;
        }
    }

    try {
        const response = await user.save();
        await pushDashboardStats();
        // Pusher event: user profile updated
        pusher.trigger('user', 'profile_updated', { user: response });
        return res.status(200).json({ message: "User profile updated successfully", user: response });
    } catch (error) {
        return res.status(500).json({
            message: "Could not update user profile",
            error: error.message
        });
    }
});

// Delete user (admin only)
router.delete('/:userId/deleteUser', authJs, async (req, res) => {
    const userId = req.params.userId;
    const isAdmin = req.decoded && req.decoded.isAdmin;

    if (!isAdmin) {
        return res.status(403).send("Unauthorized, you are not an admin");
    }

    try {
        const deletedUser = await User.findByIdAndDelete(userId);
        await pushDashboardStats();

        if (!deletedUser) {
            return res.status(404).send("User does not exist");
        }

        // Pusher event: user deleted
        pusher.trigger('user', 'deleted', { userId });
        return res.status(200).json({ message: "User deleted successfully", deletedUser: deletedUser });
    } catch (error) {
        return res.status(500).json({
            message: "Error occurred, user was not deleted",
            error: error.message
        });
    }
});


/**
 * PATCH /profile_image
 * Accepts { imageBase64, filename, mimetype } in body, or { imageUrl }
 * Only allow update if user did NOT sign up with Google
 * Creates a folder named after userId, deletes any previous folder/image, and uploads the new image.
 * Also saves the file extension in user.avatarExtension and appends .extension to the avatar URL.
 */
router.patch('/profile_image', authJs, async (req, res) => {
    const userId = req.decoded && req.decoded.userId;
    let user = await User.findById(userId);

    if (!user) {
        return res.status(404).send("Couldn't find user");
    }
    if (user.googleId) {
        return res.status(403).json({ message: "Profile image update not allowed for Google-authenticated users" });
    }

    let buffer, filename, mimetype, extension;

    if (req.body.imageBase64 && req.body.filename && req.body.mimetype) {
        try {
            buffer = Buffer.from(req.body.imageBase64, 'base64');
            mimetype = req.body.mimetype;
            extension = mime.extension(mimetype) || 'jpg';
            // Ensure filename has correct extension
            filename = req.body.filename;
            if (!filename.endsWith(`.${extension}`)) {
                filename = filename.replace(/\.[^/.]+$/, "") + `.${extension}`;
            }
        } catch (err) {
            return res.status(400).json({ message: "Invalid base64 image data" });
        }
    } else if (req.body.imageUrl) {
        try {
            const axiosResponse = await axios.get(req.body.imageUrl, { responseType: 'arraybuffer' });
            buffer = Buffer.from(axiosResponse.data, 'binary');
            mimetype = axiosResponse.headers['content-type'] || 'image/jpeg';
            extension = mime.extension(mimetype) || 'jpg';
            // Try to get filename from URL, fallback to userId + extension
            let base = path.basename(req.body.imageUrl.split('?')[0]);
            if (!base || !base.includes('.')) {
                base = `${userId}.${extension}`;
            } else if (!base.endsWith(`.${extension}`)) {
                base = base.replace(/\.[^/.]+$/, "") + `.${extension}`;
            }
            filename = base;
        } catch (err) {
            return res.status(400).json({ message: "Could not fetch image from URL" });
        }
    } else {
        return res.status(400).json({ message: "No image data provided. Use imageBase64 or imageUrl." });
    }

    // Only allow certain extensions
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'avif'];
    if (!allowedExtensions.includes(extension)) {
        return res.status(400).json({ message: "Only jpg, jpeg, png, avif images are allowed" });
    }

    try {
        // Upload the image to Cloudinary
        const avatarUrl = await uploadBufferToCloudinary(buffer, filename, mimetype);
        user.avatar = avatarUrl;
        user.avatarExtension = extension;
        const response = await user.save();
        // Pusher event: user profile image updated
        pusher.trigger('user', 'profile_image_updated', { user: response });
        return res.status(200).json({ message: "User profile image updated successfully", user: response });
    } catch (error) {
        console.error('Profile image upload error:', error);
        return res.status(500).json({
            message: "Could not update user profile image",
            error: error.message
        });
    }
});

// Start Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.CLIENT_URL}/login` }),
  (req, res) => {
    const token = jwt.sign(
      { userId: req.user._id, isAdmin: req.user.isAdmin, isSuperAdmin: req.user.isSuperAdmin },
      process.env.TOKEN_SECRET_WORD,
      { expiresIn: '1d' }
    );
    res.redirect(`${process.env.CLIENT_URL}/google-success?token=${token}`);
  }
);

// api to update user userCourse
router.patch('/update-user-course', authJs, async (req, res) => {
    const userId = req.decoded && req.decoded.userId;
    const { userCourse } = req.body;

    if (!userCourse) {
        return res.status(400).json({ message: "User course is required" });
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        user.userCourse = userCourse;
        const updatedUser = await user.save();

        // Pusher event: user course updated
        pusher.trigger('user', 'course_updated', { user: updatedUser });
        return res.status(200).json({
            message: "User course updated successfully",
            user: updatedUser
        });
    } catch (error) {
        return res.status(500).json({
            message: "Error updating user course",
            error: error.message
        });
    }
});

router.get('/me', authJs, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        const userId = req.decoded && req.decoded.userId;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: "Error fetching user", error: error.message });
    }
});

// Forgot Password - Send reset link
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const user = await User.findOne({ email });
        if (!user) {
            // Don't reveal if user exists for security
            return res.json({ success: true, message: 'If this email exists, a reset link has been sent' });
        }

        const resetToken = jwt.sign({ userId: user._id }, process.env.TOKEN_SECRET_WORD, { expiresIn: '15m' });
        user.resetToken = resetToken;
        user.resetTokenExpiration = Date.now() + 900000; // 15 minutes
        await user.save();

        const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Password Reset Request</h2>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                We received a request to reset your password. Click the button below to reset it.
                This link will expire in 15 minutes.
              </p>
              
              <div style="text-align: center;">
                <a href="${resetLink}" 
                   style="display: inline-block; background-color: #3498db; color: white; 
                          padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                  Reset Password
                </a>
              </div>
            </div>
            
            <p style="text-align: center; color: #7f8c8d; font-size: 14px;">
              Or copy this link: <span style="word-break: break-all;">${resetLink}</span>
            </p>
            
            <p style="font-size: 12px; color: #95a5a6; text-align: center; margin-top: 30px;">
              If you didn't request this, please ignore this email.
            </p>
          </div>
        `;

        await sendEmail(email, 'Password Reset Request', html);
        return res.json({ success: true, message: 'If this email exists, a reset link has been sent' });
    } catch (err) {
        return res.status(500).json({ message: 'Error processing request', error: err.message });
    }
});

// Request password reset
router.post('/request-reset-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // Generate reset token
        const resetToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        
        // Save token to user
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
        await user.save();

        // Send email with reset link (implementation depends on your email service)
        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
        // sendResetEmail(user.email, resetLink);

        return res.status(200).json({ success: true, message: 'Password reset link sent' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Reset password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Token and new password are required',
                error: 'MISSING_FIELDS'
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.TOKEN_SECRET_WORD);
        const user = await User.findOne({
            _id: decoded.userId,
            resetToken: token,
            resetTokenExpiration: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid or expired token',
                error: 'INVALID_TOKEN'
            });
        }

        // Update password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        user.resetToken = undefined;
        user.resetTokenExpiration = undefined;
        await user.save();

        return res.status(200).json({ 
            success: true, 
            message: 'Password updated successfully'
        });
    } catch (err) {
        console.error(err);
        if (err.name === 'JsonWebTokenError') {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid token',
                error: 'INVALID_TOKEN'
            });
        }
        return res.status(500).json({ 
            success: false,
            message: 'Server error',
            error: 'SERVER_ERROR'
        });
    }
});

module.exports = router;