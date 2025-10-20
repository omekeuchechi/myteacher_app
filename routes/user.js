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
const Course = require('../models/course');
const InstructorApplication = require('../models/instructorApplication');
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
        const { name, email, password } = req.body;

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

        await sendEmail({
            to: email,
            subject: 'Verify Your Email',
            html: html
        });

        const user = new User({ name, email, password: hashedPassword, verificationToken: token, isVerified: false });
        const response = await user.save();
        await pushDashboardStats();

        const viewResponse = {
            _id: response._id,
            name: response.name,
            email: response.email,
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

// instructor auth
// Instructor Authentication
router.post('/instructorAuth', async (req, res) => {
    try {
        const { passCode, password, termsAccepted } = req.body;
        
        // Input validation
        if (!passCode) {
            return res.status(400).json({ success: false, message: 'Passcode is required' });
        }
        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required' });
        }
        if (!termsAccepted) {
            return res.status(400).json({ success: false, message: 'Terms and conditions must be accepted' });
        }

        // Find application by passCode
        const application = await InstructorApplication.findOne({ _id: passCode });
        if (!application) {
            return res.status(404).json({ success: false, message: 'Invalid passcode' });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email: application.email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'Instructor account already exists. Please log in instead.' 
            });
        }

        // Hash password and create JWT token
        const hashedPassword = await bcrypt.hash(password, 12);
        const token = jwt.sign({ 
            email: application.email,
            isInstructor: true,
            userId: existingUser?._id 
        }, process.env.TOKEN_SECRET_WORD, { expiresIn: '24h' });

        // Find course by job position
        const course = await Course.findOne({ course: application.jobPosition });

        // Create new instructor user
        const user = new User({ 
            name: application.name, 
            email: application.email, 
            password: hashedPassword, 
            verificationToken: null, 
            isVerified: true, 
            isAdmin: true, // Changed from true to false as instructors shouldn't be admins by default
            isInstructor: true,
            instructorCourses: course ? [course._id] : [],
            termsAccepted: termsAccepted,
            country: application.location?.country,
            city: application.location?.city
        });

        const savedUser = await user.save();
        await pushDashboardStats();

        // Update application status
        application.status = 'approved';
        await application.save();

        // Prepare response
        const userResponse = {
            _id: savedUser._id,
            name: savedUser.name,
            email: savedUser.email,
            isInstructor: savedUser.isInstructor,
            instructorCourses: savedUser.instructorCourses
        };

        
        // Send welcome email

    const welcomeEmailTemplate = (name) => `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to MyTeacher - Instructor Account Created</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    line-height: 1.6;
                    color: #333333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f9f9f9;
                }
                .container {
                    background-color: #ffffff;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                    overflow: hidden;
                }
                .header {
                    background-color: #4a6ee0;
                    padding: 30px 20px;
                    text-align: center;
                    color: white;
                }
                .header h1 {
                    margin: 0;
                    font-size: 24px;
                    font-weight: 600;
                }
                .content {
                    padding: 30px;
                }
                .greeting {
                    font-size: 18px;
                    margin-bottom: 20px;
                    color: #2d3748;
                }
                .message {
                    margin-bottom: 25px;
                    color: #4a5568;
                }
                .cta-button {
                    display: inline-block;
                    background-color: #4a6ee0;
                    color: white !important;
                    text-decoration: none;
                    padding: 12px 24px;
                    border-radius: 5px;
                    font-weight: 600;
                    margin: 15px 0;
                }
                .features {
                    margin: 25px 0;
                    padding: 0;
                }
                .feature {
                    display: flex;
                    align-items: flex-start;
                    margin-bottom: 15px;
                }
                .feature-icon {
                    color: #4a6ee0;
                    margin-right: 12px;
                    font-size: 20px;
                }
                .feature-text {
                    flex: 1;
                }
                .footer {
                    text-align: center;
                    padding: 20px;
                    font-size: 14px;
                    color: #718096;
                    border-top: 1px solid #e2e8f0;
                    margin-top: 20px;
                }
                .logo {
                    max-width: 180px;
                    margin-bottom: 15px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Welcome to MyTeacher</h1>
                    <p>Your Instructor Journey Begins Now!</p>
                </div>
                
                <div class="content">
                    <div class="greeting">Hello ${name},</div>
                    
                    <div class="message">
                        <p>Congratulations! Your instructor account has been successfully created and you're now part of our growing community of educators.</p>
                        <p>We're excited to have you on board and can't wait to see the knowledge you'll share with our students.</p>
                    </div>

                    <div style="text-align: center; margin: 30px 0;">
                        <a href="https://myteacher.institute/instructor/dashboard" class="cta-button">Go to Your Dashboard</a>
                    </div>

                    <div class="features">
                        <h3 style="margin-top: 30px; color: #2d3748;">Getting Started:</h3>
                        
                        <div class="feature">
                            <div class="feature-icon">✓</div>
                            <div class="feature-text">
                                <strong>Complete Your Profile</strong>
                                <p>Add your bio, profile picture, and teaching credentials to build trust with students.</p>
                            </div>
                        </div>
                        
                        <div class="feature">
                            <div class="feature-icon">✓</div>
                            <div class="feature-text">
                                <strong>Create Your First Course</strong>
                                <p>Start building your course content with our easy-to-use course creation tools.</p>
                            </div>
                        </div>
                        
                        <div class="feature">
                            <div class="feature-icon">✓</div>
                            <div class="feature-text">
                                <strong>Set Your Schedule</strong>
                                <p>Choose your availability and start accepting students for live sessions.</p>
                            </div>
                        </div>
                    </div>

                    <div style="background-color: #f7fafc; padding: 20px; border-radius: 6px; margin-top: 30px;">
                        <h4 style="margin-top: 0; color: #2d3748;">Need Help?</h4>
                        <p>Our support team is here to help you succeed. Feel free to reach out to us at <a href="myteacheronlineclass1@gmail.com" style="color: #4a6ee0; text-decoration: none;">myteacheronlineclass1@gmail.com</a> or visit our <a href="https://myteacher.institute/help" style="color: #4a6ee0; text-decoration: none;">Help Center</a>.</p>
                    </div>
                </div>
                
                <div class="footer">
                    <p>© ${new Date().getFullYear()} MyTeacher Institute. All rights reserved.</p>
                    <p>
                        <a href="https://myteacher.institute" style="color: #4a6ee0; text-decoration: none; margin: 0 10px;">Website</a> | 
                        <a href="https://myteacher.institute/privacy" style="color: #4a6ee0; text-decoration: none; margin: 0 10px;">Privacy Policy</a> | 
                        <a href="https://myteacher.institute/terms" style="color: #4a6ee0; text-decoration: none; margin: 0 10px;">Terms of Service</a>
                    </p>
                    <p style="font-size: 12px; color: #a0aec0; margin-top: 20px;">
                        You're receiving this email because you created an instructor account with MyTeacher.
                        <br>
                        <a href="#" style="color: #a0aec0; text-decoration: underline;">Unsubscribe</a> from these emails.
                    </p>
                </div>
            </div>
        </body>
        </html>
        `;

        await sendEmail({
            to: savedUser.email,
            subject: 'Welcome to MyTeacher as an Instructor!',
            html: welcomeEmailTemplate(savedUser.name)
        });

        return res.status(201).json({
            success: true,
            message: "Instructor account created successfully",
            token,
            user: userResponse
        });

    } catch (err) {
        console.error('Error in instructor authentication:', err);
        return res.status(500).json({
            success: false,
            message: "Error creating instructor account",
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Update Instructor Profile
router.put('/instructor/profile', authJs, async (req, res) => {
    try {
        const { name, email, password, currentPassword, instructorCourses, country, city } = req.body;
        const userId = req.decoded?.userId;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const user = await User.findById(userId);
        if (!user || !user.isInstructor) {
            return res.status(403).json({ success: false, message: 'Instructor access required' });
        }

        // Update basic info
        if (name) user.name = name;
        if (email) user.email = email;
        if (country) user.country = country;
        if (city) user.city = city;

        // Update password if current password is provided
        if (password && currentPassword) {
            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                return res.status(400).json({ success: false, message: 'Current password is incorrect' });
            }
            user.password = await bcrypt.hash(password, 12);
        }

        // Update instructor courses if provided
        if (instructorCourses && Array.isArray(instructorCourses)) {
            // Verify all course IDs exist
            const courses = await Course.find({ _id: { $in: instructorCourses } });
            if (courses.length !== instructorCourses.length) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'One or more course IDs are invalid' 
                });
            }
            user.instructorCourses = instructorCourses;
        }

        const updatedUser = await user.save();

        // Prepare response
        const userResponse = {
            _id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            isInstructor: updatedUser.isInstructor,
            instructorCourses: updatedUser.instructorCourses,
            country: updatedUser.country,
            city: updatedUser.city
        };

        return res.json({
            success: true,
            message: 'Profile updated successfully',
            user: userResponse
        });

    } catch (err) {
        console.error('Error updating instructor profile:', err);
        return res.status(500).json({
            success: false,
            message: 'Error updating profile',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Instructor Login route
router.post('/instructor/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Input validation
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password are required' 
            });
        }

        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }

        // Check if user is an instructor
        if (!user.isInstructor) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Not an instructor account.' 
            });
        }

        // Check instructor application status
        const application = await InstructorApplication.findOne({ email: user.email });
        if (!application || application.status !== 'approved') {
            return res.status(403).json({ 
                success: false,
                message: 'Your instructor application is either pending or not approved' 
            });
        }

        // Check if email is verified
        if (!user.isVerified) {
            return res.status(403).json({ message: 'Email not verified' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user._id }, process.env.TOKEN_SECRET_WORD, { expiresIn: '30d' });
        return res.json({ success: true, message: 'Login successful', token });
    } catch (err) {
        console.error('Error logging in:', err);
        return res.status(500).json({ success: false, message: 'Error logging in', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
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

        await sendEmail({
            to: user.email,
            subject: 'Your Email is Verified',
            html: htmlContent
        });

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

        await sendEmail({
            to: email,
            subject: 'Email Verification',
            html: html
        });

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
            // Include all necessary user information in the token
            const token = jwt.sign(
                { 
                    id: user._id,  // Use 'id' for consistency
                    userId: user._id,  // Keep for backward compatibility
                    email: user.email,
                    name: user.name,
                    isAdmin: user.isAdmin, 
                    isSuperAdmin: user.isSuperAdmin 
                },
                process.env.TOKEN_SECRET_WORD,
                { expiresIn: '30d' }
            );

            // Don't send sensitive information in the response
            const { password, ...userWithoutPassword } = user.toObject();
            
            return res.status(200).json({
                success: true,
                message: "User authenticated successfully",
                token: token,
                user: userWithoutPassword,
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
            return res.status(400).json({ 
                success: false,
                message: "Email is required" 
            });
        }

        const user = await User.findOne({ email });
        if (!user) {
            // For security, don't reveal if the email exists
            return res.json({ 
                success: true, 
                message: 'If this email exists, a password reset link has been sent.' 
            });
        }

        // Generate reset token (15 minutes expiry)
        const resetToken = jwt.sign(
            { userId: user._id },
            process.env.TOKEN_SECRET_WORD,
            { expiresIn: '15m' }
        );

        // Save token to user
        user.resetToken = resetToken;
        user.resetTokenExpiration = Date.now() + 15 * 60 * 1000; // 15 minutes
        await user.save();

        // Create reset link
        const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
        
        // Email template
        const emailContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background-color: #4a6fdc; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                    <h1 style="color: white; margin: 0;">Password Reset Request</h1>
                </div>
                <div style="padding: 20px; background-color: #f8f9fa; border-radius: 0 0 8px 8px;">
                    <p>Hello ${user.name || 'there'},</p>
                    <p>We received a request to reset your password. Click the button below to proceed:</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" 
                           style="display: inline-block; background-color: #4a6fdc; color: white; 
                                  padding: 12px 24px; text-decoration: none; border-radius: 4px;">
                            Reset Password
                        </a>
                    </div>
                    
                    <p>This link will expire in 15 minutes for security reasons.</p>
                    <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
                    
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666; font-size: 14px;">
                        <p>If the button doesn't work, copy and paste this link into your browser:</p>
                        <p style="word-break: break-all;">${resetLink}</p>
                    </div>
                </div>
                <div style="text-align: center; color: #95a5a6; font-size: 12px; margin-top: 20px;">
                    <p>This is an automated message from ${process.env.APP_NAME || 'MyTeacher App'}. Please do not reply to this email.</p>
                    <p> ${new Date().getFullYear()} ${process.env.APP_NAME || 'MyTeacher App'}. All rights reserved.</p>
                </div>
            </div>
        `;

        // Send email
        await sendEmail({
            to: user.email,
            subject: 'Password Reset Request',
            html: emailContent
        });

        return res.json({ 
            success: true, 
            message: 'If this email exists, a password reset link has been sent.' 
        });

    } catch (error) {
        console.error('Password reset error:', error);
        return res.status(500).json({ 
            success: false,
            message: 'An error occurred while processing your request',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Reset password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        
        // Validate input
        if (!token || !newPassword) {
            return res.status(400).json({ 
                success: false,
                message: 'Token and new password are required',
                error: 'MISSING_FIELDS'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters long',
                error: 'PASSWORD_TOO_SHORT'
            });
        }

        // Verify token and find user
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.TOKEN_SECRET_WORD);
        } catch (err) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired token',
                error: 'INVALID_TOKEN'
            });
        }

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

        // Check if new password is the same as old password
        const isSamePassword = await bcrypt.compare(newPassword, user.password);
        if (isSamePassword) {
            return res.status(400).json({
                success: false,
                message: 'New password cannot be the same as the old password',
                error: 'SAME_PASSWORD'
            });
        }

        // Update password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        user.resetToken = undefined;
        user.resetTokenExpiration = undefined;
        await user.save();

        // Send confirmation email
        const emailContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background-color: #4caf50; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                    <h1 style="color: white; margin: 0;">Password Updated Successfully</h1>
                </div>
                <div style="padding: 20px; background-color: #f8f9fa; border-radius: 0 0 8px 8px;">
                    <p>Hello ${user.name || 'there'},</p>
                    <p>Your password has been successfully updated. If you didn't make this change, please contact our support team immediately.</p>
                    
                    <div style="margin-top: 30px; padding: 15px; background-color: #e8f5e9; border-radius: 4px;">
                        <p style="margin: 0; color: #2e7d32;">
                            <strong>Security Tip:</strong> For your security, we recommend using a strong, unique password and enabling two-factor authentication if available.
                        </p>
                    </div>
                </div>
                <div style="text-align: center; color: #95a5a6; font-size: 12px; margin-top: 20px;">
                    <p>This is an automated message from ${process.env.APP_NAME || 'MyTeacher App'}. Please do not reply to this email.</p>
                    <p> ${new Date().getFullYear()} ${process.env.APP_NAME || 'MyTeacher App'}. All rights reserved.</p>
                </div>
            </div>
        `;

        await sendEmail({
            to: user.email,
            subject: 'Your Password Has Been Updated',
            html: emailContent
        });

        return res.json({ 
            success: true, 
            message: 'Password has been reset successfully' 
        });

    } catch (error) {
        console.error('Password reset error:', error);
        return res.status(500).json({ 
            success: false,
            message: 'An error occurred while resetting your password',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
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

module.exports = router;