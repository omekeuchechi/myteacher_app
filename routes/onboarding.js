const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Onboarding = require('../models/onboarding');
const authJs = require('../middlewares/auth');
const sendEmail = require('../lib/sendEmail');
const pusher = require('../services/pusherService');

// Rate limiting configuration
const createAccountLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // Limit each IP to 300 requests per windowMs
  message: {
    success: false,
    message: 'Too many accounts created from this IP, please try again after a minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true,
  keyGenerator: (req) => req.ip
});

// @route   POST /api/onboarding
// @desc    Create a new onboarding entry
// @access  Public
router.post('/create', createAccountLimiter, async (req, res) => {
  try {
    const { name, email, countryCode, phone, course } = req.body;
    
    // Check if user already exists with the same email or phone
    const existingUser = await Onboarding.findOne({
      $or: [
        { email: email.toLowerCase() },
        { phone, countryCode }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone number already exists'
      });
    }

    // Create new onboarding entry
    const onboarding = new Onboarding({
      name,
      email: email.toLowerCase(),
      countryCode,
      phone,
      course,
      metadata: {
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      }
    });

    await onboarding.save();

    // Send real-time notification
    try {
      await pusher.trigger('onboarding', 'new-submission', {
        id: onboarding._id,
        name: onboarding.name,
        email: onboarding.email,
        phone: `+${countryCode} ${phone}`,
        course: onboarding.course,
        timestamp: new Date().toISOString()
      });
    } catch (pusherError) {
      console.error('Failed to send Pusher notification:', pusherError);
      // Don't fail the request if Pusher notification fails
    }

    // Send welcome email

    const siteEmail = process.env.SITE_EMAIL;

    try {
      await sendEmail({
        to: email,
        subject: 'Welcome to MyTeacher!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #4a6cf7; color: white; padding: 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600;">Welcome to MyTeacher!</h1>
            </div>
            
            <div style="padding: 25px; background-color: #ffffff;">
              <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
                <h2 style="color: #333333; font-size: 18px; margin: 0 0 15px 0;">User Details</h2>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #666666; width: 120px; vertical-align: top;">Name:</td>
                    <td style="padding: 8px 0; font-weight: 500; color: #333333;">${name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666666; vertical-align: top;">Email:</td>
                    <td style="padding: 8px 0;">
                      <a href="mailto:${email}" style="color: #4a6cf7; text-decoration: none;">${email}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666666; vertical-align: top;">Phone:</td>
                    <td style="padding: 8px 0; color: #333333;">
                      +${countryCode} ${phone}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666666; vertical-align: top;">Course:</td>
                    <td style="padding: 8px 0; color: #333333;">
                      ${course}
                    </td>
                  </tr>
                </table>
              </div>
              
              <div style="text-align: center; margin-top: 25px; color: #999999; font-size: 13px;">
                <p style="margin: 0;">This is an automated message. Please do not reply to this email.</p>
                <p style="margin: 10px 0 0 0;">&copy; ${new Date().getFullYear()} MyTeacher Institute. All rights reserved.</p>
              </div>
            </div>
          </div>
        `,
      });
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail the request if email sending fails
    }

    // Send admin notification
    try {
      await sendEmail({
        to: siteEmail,
        subject: 'New Onboarding Submission',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #4a6cf7; color: white; padding: 20px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600;">New Onboarding Submission</h1>
            </div>
            
            <div style="padding: 25px; background-color: #ffffff;">
              <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #f0f0f0;">
                <h2 style="color: #333333; font-size: 18px; margin: 0 0 15px 0;">User Details</h2>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #666666; width: 120px; vertical-align: top;">Name:</td>
                    <td style="padding: 8px 0; font-weight: 500; color: #333333;">${name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666666; vertical-align: top;">Email:</td>
                    <td style="padding: 8px 0;">
                      <a href="mailto:${email}" style="color: #4a6cf7; text-decoration: none;">${email}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666666; vertical-align: top;">Phone:</td>
                    <td style="padding: 8px 0; color: #333333;">
                      +${countryCode} ${phone}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666666; vertical-align: top;">Course:</td>
                    <td style="padding: 8px 0; color: #333333;">
                      ${course}
                    </td>
                  </tr>
                </table>
              </div>
              
              <div style="text-align: center; margin-top: 25px; color: #999999; font-size: 13px;">
                <p style="margin: 0;">This is an automated message. Please do not reply to this email.</p>
                <p style="margin: 10px 0 0 0;">&copy; ${new Date().getFullYear()} MyTeacher Institute. All rights reserved.</p>
              </div>
            </div>
          </div>
        `,
      });
    } catch (adminEmailError) {
      console.error('Failed to send admin notification:', adminEmailError);
    }

    res.status(201).json({
      success: true,
      message: 'Thank you for your submission! We will contact you soon.',
      data: {
        id: onboarding._id,
        name: onboarding.name,
        email: onboarding.email
      }
    });
  } catch (error) {
    console.error('Onboarding error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/onboarding
// @desc    Get all onboarding entries (Admin only)
// @access  Private/Admin
router.get('/', authJs, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = {};
    
    if (status) {
      query.status = status;
    }

    const options = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      sort: { createdAt: -1 },
      select: '-__v -fullPhoneNumber -metadata'
    };

    const result = await Onboarding.paginate(query, options);

    res.json({
      success: true,
      data: result.docs,
      pagination: {
        total: result.totalDocs,
        totalPages: result.totalPages,
        page: result.page,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage
      }
    });
  } catch (error) {
    console.error('Get all onboarding error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/onboarding/:id
// @desc    Get single onboarding entry by ID (Admin only)
// @access  Private/Admin
router.get('/:id', authJs, async (req, res) => {
  try {
    const onboarding = await Onboarding.findById(req.params.id)
      .select('-__v -fullPhoneNumber');

    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: 'Onboarding entry not found'
      });
    }

    res.json({
      success: true,
      data: onboarding
    });
  } catch (error) {
    console.error('Get onboarding by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   DELETE /api/onboarding/:id
// @desc    Delete an onboarding entry by ID (Admin only)
// @access  Private/Admin
router.delete('/delete/:id', authJs, async (req, res) => {
  try {
    const onboarding = await Onboarding.findByIdAndDelete(req.params.id);

    if (!onboarding) {
      return res.status(404).json({
        success: false,
        message: 'Onboarding entry not found'
      });
    }

    res.json({
      success: true,
      message: 'Onboarding entry deleted successfully',
      data: {
        id: onboarding._id,
        name: onboarding.name,
        email: onboarding.email
      }
    });
  } catch (error) {
    console.error('Delete onboarding error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/onboarding/subscribe
// @desc    Subscribe to onboarding real-time updates (for admin dashboard)
// @access  Private/Admin
router.get('/subscribe', authJs, (req, res) => {
  try {
    const socketId = req.body.socket_id;
    const channel = req.body.channel_name;
    
    // Authenticate the user's socket connection
    const authResponse = pusher.authenticate(socketId, channel);
    res.send(authResponse);
  } catch (error) {
    console.error('Pusher auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Error authenticating Pusher connection'
    });
  }
});

module.exports = router;