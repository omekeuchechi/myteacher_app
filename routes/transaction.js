const express = require('express');
const router = express.Router();
const axios = require('axios');
const authJs = require('../middlewares/auth');
const Course = require('../models/course');
const Transaction = require('../models/transaction');
const Enrollment = require('../models/enrollment');
const { SingleCrt, MultipleCrt } = require('../models/crt');
const Lecture = require('../models/lecture'); // Import Lecture model
const UpcomingLectureBatch = require('../models/upcomingLectureBatch'); // Import UpcomingLectureBatch model
const Pusher = require('pusher');
const sendEmail = require('../lib/sendEmail');
const User = require('../models/user'); // Import User model

// Initialize Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// FLUTTERWAVE PAYMENT INITIALIZATION
// router.post('/pay/flutterwave', authJs, async (req, res) => {
//   try {
//     const { userId, courseId, amount } = req.body;

//     const course = await Course.findById(courseId);
//     if (!course) return res.status(404).json({ message: 'Course not found' });

//     if (amount !== course.price) {
//       return res.status(400).json({ message: 'Incorrect payment amount' });
//     }

//     const txRef = `fla_${Date.now()}`;

//     const response = await axios.post(
//       'https://api.flutterwave.com/v3/payments',
//       {
//         tx_ref: txRef,
//         amount,
//         currency: 'NGN',
//         redirect_url: 'https://yourdomain.com/flutterwave/callback',
//         customer: {
//           email: req.user?.email || 'user@example.com' // Use authenticated user email if available
//         },
//         meta: { userId, courseId }
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
//         }
//       }
//     );

//     await Transaction.create({
//       userId,
//       courseId,
//       amount,
//       currency: 'NGN',
//       paymentReference: txRef,
//       status: 'pending',
//       paymentMethod: 'flutterwave'
//     });

//     res.json({ link: response.data.data.link });
//   } catch (error) {
//     console.error('Flutterwave payment init error:', error.response?.data || error.message);
//     res.status(500).json({ message: 'Flutterwave payment initiation failed' });
//   }
// });

// // FLUTTERWAVE CALLBACK
// router.post('/flutterwave/callback', async (req, res) => {
//   try {
//     const { data } = req.body;

//     if (data.status !== 'successful') return res.sendStatus(200);

//     const txRef = data.tx_ref;

//     const transaction = await Transaction.findOne({ paymentReference: txRef });
//     if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

//     await Transaction.updateOne({ paymentReference: txRef }, { status: 'completed' });

//     const { userId, courseId } = transaction;
//     const course = await Course.findById(courseId);
//     if (!course) return res.status(404).json({ message: 'Course not found' });

//     const enrolledAt = new Date();
//     const expiryDate = new Date(enrolledAt);
//     expiryDate.setDate(enrolledAt.getDate() + course.durationWeeks * 7);

//     await Enrollment.create({ userId, courseId, enrolledAt, expiryDate });

//     res.sendStatus(200);
//   } catch (error) {
//     console.error('Flutterwave callback error:', error.response?.data || error.message);
//     res.status(500).json({ message: 'Callback handling failed' });
//   }
// });

// PAYSTACK PAYMENT INITIALIZATION
router.post('/pay/paystack', authJs, async (req, res) => {
  try {
    const { userId, courseId, courseName, linkedLecture } = req.body;

    if (!courseId && !courseName) {
      return res.status(400).json({ 
        message: 'Either courseId or courseName is required' 
      });
    }

    // Check for existing enrollment within last 5 days
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    
    const existingEnrollment = await Enrollment.findOne({
      userId,
      courseId: courseId || courseName, // Use either ID or name for the check
      enrolledAt: { $gte: fiveDaysAgo }
    });

    if (existingEnrollment) {
      return res.status(400).json({ 
        message: 'You are already enrolled in this course within the last 5 days',
        enrolledAt: existingEnrollment.enrolledAt
      });
    }

    // Find course by ID or name
    let course;
    if (courseId) {
      course = await Course.findById(courseId);
    } else {
      course = await Course.findOne({ course: courseName });
    }

    if (!course) {
      return res.status(404).json({ 
        message: 'Course not found',
        details: courseId ? `No course found with ID: ${courseId}` : `No course found with name: ${courseName}`
      });
    }

    // If linkedLecture is provided, verify it exists and belongs to the same course
    if (linkedLecture) {
      const lecture = await Lecture.findOne({ 
        _id: linkedLecture,
        courseId: course._id 
      });
      
      if (!lecture) {
        return res.status(400).json({ 
          message: 'Invalid lecture reference or lecture does not belong to this course' 
        });
      }
    }

    const amount = course.price;
    const currency = 'NGN'; // Or USD depending on your setup

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: req.user?.email || req.body.email || 'user@example.com',
        amount: amount * 100, // In kobo
        currency,
        metadata: { 
          userId, 
          courseId: course._id, // Use the resolved course ID
          linkedLecture: linkedLecture || null // Include linkedLecture in metadata
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_MODE === 'DEVELOPMENT' ? process.env.PAYSTACK_TESTING_SECRET_KEY : process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    if (!response.data.data) {
      throw new Error('Invalid Paystack response');
    }

    const { reference, authorization_url } = response.data.data;

    await Transaction.create({
      userId,
      courseId: course._id,
      amount,
      currency,
      paymentReference: reference,
      status: 'pending',
      paymentMethod: 'paystack'
    });

    res.json({ authorization_url });
  } catch (error) {
    console.error('Paystack init error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Paystack payment initialization failed' });
  }
});

// PAYSTACK CALLBACK
router.all('/paystack/callback', async (req, res) => {
  const { reference } = req.query;

  try {
    // First verify the payment
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_MODE === 'DEVELOPMENT' ? process.env.PAYSTACK_TESTING_SECRET_KEY : process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const paymentData = response.data.data;
    if (paymentData.status !== 'success') {
      return res.send('Payment was not successful.');
    }

    const { userId, courseId } = paymentData.metadata;
    
    // Check again in callback to prevent race conditions
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    
    const existingEnrollment = await Enrollment.findOne({
      userId,
      courseId,
      enrolledAt: { $gte: fiveDaysAgo }
    });

    if (existingEnrollment) {
      // Refund or mark transaction as duplicate
      await Transaction.updateOne({ paymentReference: reference }, { 
        status: 'duplicate',
        notes: `Duplicate enrollment attempt within 5 days (existing enrollment: ${existingEnrollment.enrolledAt})`
      });
      
      return res.status(400).json({ 
        message: 'You are already enrolled in this course within the last 5 days',
        enrolledAt: existingEnrollment.enrolledAt,
        expiryDate: existingEnrollment.expiryDate
      });
    }

    await Transaction.updateOne({ paymentReference: reference }, { status: 'completed' });

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).send('Course not found');

    const enrolledAt = new Date();
    const expiryDate = new Date(enrolledAt);
    expiryDate.setDate(enrolledAt.getDate() + course.durationWeeks * 7);

    // Create enrollment
    const enrollment = await Enrollment.create({ 
      userId, 
      courseId, 
      enrolledAt, 
      expiryDate,
      linkedLecture: paymentData.metadata.linkedLecture // Store the linked lecture reference
    });

    // Add user to all active lecture batches for this course
    const currentDate = new Date();
    
    // If we have a specific linkedLecture, only update that one
    if (paymentData.metadata.linkedLecture) {
      // 1. Update the specific Lecture document
      const updatedLecture = await Lecture.findByIdAndUpdate(
        paymentData.metadata.linkedLecture,
        { 
          $addToSet: { studentsEnrolled: userId } // Add user if not already enrolled
        },
        { new: true }
      );

      // 2. Update the corresponding UpcomingLectureBatch if it exists
      await UpcomingLectureBatch.updateOne(
        { 
          linkedLecture: paymentData.metadata.linkedLecture,
          startTime: { $gt: currentDate } // Only future batches
        },
        {
          $addToSet: { booked: userId } // Add user to booked list if not already present
        }
      );

      // Prepare lectures list for email
      updatedLectures = updatedLecture ? [updatedLecture] : [];
    } else {
      // Original logic for when there's no specific linkedLecture
      // 1. Update Lectures collection for future/active lectures
      updatedLectures = await Lecture.findAndUpdateMany(
        { 
          courseId,
          startTime: { $gt: currentDate }, // Future lectures
          expiringDate: { $gt: currentDate } // Not expired
        },
        { 
          $addToSet: { studentsEnrolled: userId } // Add user if not already enrolled
        },
        { new: true } // Return the updated documents
      );

      // 2. Update corresponding UpcomingLectureBatch documents
      if (updatedLectures.length > 0) {
        const lectureIds = updatedLectures.map(lecture => lecture._id);
        await UpcomingLectureBatch.updateMany(
          { 
            linkedLecture: { $in: lectureIds },
            startTime: { $gt: currentDate } // Only future batches
          },
          {
            $addToSet: { booked: userId } // Add user to booked list if not already present
          }
        );
      }
    }

    // Get user details for email
    const user = await User.findById(userId);

    // Send enrollment confirmation email
    try {
      const lecturesList = updatedLectures.length > 0 ? 
        updatedLectures.map(lecture => `
          <div style="margin: 15px 0; padding: 10px; background: #f5f5f5; border-radius: 5px;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50;">${lecture.title}</h4>
            <p style="margin: 5px 0;"><strong>Date & Time:</strong> ${new Date(lecture.startTime).toLocaleString()}</p>
            <p style="margin: 5px 0;"><strong>Platform:</strong> ${lecture.platform}</p>
            ${lecture.zoomLink ? `<p style="margin: 5px 0;"><a href="${lecture.zoomLink}" style="color: #3498db; text-decoration: none;">Join Class</a></p>` : ''}
          </div>
        `).join('') : 
        '<p>No upcoming classes scheduled yet. Please check back later.</p>';

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Enrollment Confirmation</h2>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <p style="font-size: 16px;">Hello ${user?.name || 'there'},</p>
            <p>You have successfully enrolled in:</p>
            <h3 style="color: #3498db; margin: 5px 0 15px 0;">${course.course}</h3>
            <p>${course.description || ''}</p>
          </div>
          
          <h3 style="color: #2c3e50; margin: 20px 0 10px 0;">Your Upcoming Classes:</h3>
          ${lecturesList}
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Amount Paid:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${(paymentData.amount / 100).toLocaleString()} ${paymentData.currency}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Transaction ID:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${reference}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Enrollment Date:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">${enrolledAt.toLocaleDateString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Access Expires:</strong></td>
              <td style="padding: 8px 0; text-align: right;">${expiryDate.toLocaleDateString()}</td>
            </tr>
          </table>
          
          <p style="text-align: center; margin-top: 30px; color: #7f8c8d;">
            Thank you for choosing MyTeacher!<br>
            <a href="${process.env.CLIENT_URL || 'https://myteacher.institute'}/dashboard" style="color: #3498db; text-decoration: none;">Access Your Dashboard</a>
          </p>
        </div>
      `;

      await sendEmail({
        to: paymentData.customer?.email || user?.email || req.user?.email || req.body.email,
        subject: `🎓 Enrollment Confirmation for ${course.course}`,
        html: htmlContent
      });
    } catch (emailError) {
      console.error('Failed to send enrollment email:', emailError);
    }

    // Notify user of successful payment
    pusher.trigger(`user-${userId}`, 'payment-completed', {
      message: 'Payment successful!',
      courseId,
      courseName: course.course,
      amount: paymentData.amount / 100,
      lectures: updatedLectures
    });

    // Notify admin dashboard of new transaction
    pusher.trigger('admin-dashboard', 'new-transaction', {
      userId,
      courseId,
      amount: paymentData.amount / 100,
      timestamp: new Date(),
      enrollmentId: enrollment._id,
      lectureCount: updatedLectures.length
    });

    res.send(`
      <html>
        <head>
          <title>Payment Successful</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .success { color: #27ae60; font-size: 24px; margin-bottom: 20px; }
            .button { 
              display: inline-block; 
              background: #3498db; 
              color: white; 
              padding: 10px 20px; 
              text-decoration: none; 
              border-radius: 5px; 
              margin-top: 20px; 
            }
          </style>
        </head>
        <body>
          <div class="success">✅ Payment Successful!</div>
          <p>You have been enrolled in ${course.course}.</p>
          ${updatedLectures.length > 0 ? 
            `<p>You've been added to ${updatedLectures.length} upcoming class${updatedLectures.length > 1 ? 'es' : ''}.</p>` : 
            ''}
          <p>Check your email for class details and schedule.</p>
          <a href="${process.env.CLIENT_URL || 'https://myteacher.institute'}/dashboard" class="button">Go to Dashboard</a>
          <script>
            setTimeout(() => {
              window.location.href = '${process.env.CLIENT_URL || 'https://myteacher.institute'}/dashboard';
            }, 5000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Paystack callback error:', error.response?.data || error.message);
    res.status(500).send('Verification failed.');
  }
});

// API for fetching all transactions (admin only) with pagination
router.get('/all-transactions', authJs, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.decoded || !req.decoded.isAdmin) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. Admin privileges required.' 
      });
    }

    // Pagination parameters with validation
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    // Build base query
    const query = {};

    // Get total count for pagination
    const total = await Transaction.countDocuments(query);

    // Fetch transactions with pagination and population
    const transactions = await Transaction.find(query)
      .populate({
        path: 'userId',
        select: 'name email avatar',
        model: 'User'
      })
      .populate({
        path: 'courseId',
        select: 'course price courseIntructor',
        model: 'Course'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(); // Convert to plain JavaScript objects

    // Format the response
    const formattedTransactions = transactions.map(transaction => ({
      ...transaction,
      user: {
        _id: transaction.userId?._id,
        name: transaction.userId?.name,
        email: transaction.userId?.email,
        avatar: transaction.userId?.avatar
      },
      course: {
        _id: transaction.courseId?._id,
        course: transaction.courseId?.course,
        price: transaction.courseId?.price,
        instructor: transaction.courseId?.instructor
      },
      userId: undefined,  // Remove the original populated fields
      courseId: undefined
    }));

    // Notify client that transactions data is ready
    pusher.trigger(`admin-${req.decoded.userId}`, 'transactions-loaded', {
      count: formattedTransactions.length,
      total
    });

    res.json({
      success: true,
      message: 'Transactions retrieved successfully',
      data: formattedTransactions,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit) || 1,
        totalItems: total,
        itemsPerPage: limit,
        hasNextPage: page * limit < total,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching transactions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API for fetching single user's transactions with user and course details
router.get('/user-transactions', authJs, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.decoded.userId })
      .populate({
        path: 'userId',
        select: 'name email',
        model: 'User' // Ensure this matches your User model name
      })
      .populate('courseId', 'course price')
      .sort({ createdAt: -1 });

    if (!transactions.length) {
      return res.status(200).json({
        message: 'No transactions found.',
        transactions: []
      });
    }

    // Format the response to include user details
    const formattedTransactions = transactions.map(transaction => ({
      ...transaction.toObject(),
      user: {
        name: transaction.userId?.name,
        email: transaction.userId?.email
      },
      userId: undefined // Remove the userId field if not needed
    }));

    res.json({
      message: 'Transactions fetched successfully.',
      transactions: formattedTransactions
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ 
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
});

router.post('/free-lecture', authJs, async (req, res) => {
    try {
        const { userId, lectureId, linkedLecture, courseImage } = req.body;
        let downloadUrl = '';  // Initialize downloadUrl at the beginning of the function
        
        // Find the user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Find the upcoming lecture batch
        const upcomingLecture = await UpcomingLectureBatch.findById(lectureId);
        if (!upcomingLecture) {
            return res.status(404).json({ success: false, message: 'Upcoming lecture not found' });
        }
        
        if (!courseImage) {
            return res.status(400).json({ success: false, message: 'Course image is required' });
        }

        // If linkedLecture is provided, add user to studentsEnrolled array of that lecture
        if (linkedLecture) {
            // First check if user is already enrolled
            const existingLecture = await Lecture.findOne({
                _id: linkedLecture,
                studentsEnrolled: { $in: [userId] }
            });

            if (existingLecture) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'You are already enrolled in this lecture' 
                });
            }

            const updatedLecture = await Lecture.findByIdAndUpdate(
                linkedLecture,
                { $addToSet: { studentsEnrolled: userId } }, // $addToSet prevents duplicates
                { new: true }
            );

            if (!updatedLecture) {
                return res.status(404).json({ success: false, message: 'Linked lecture not found' });
            }

            // Check if certificate already exists for this user and lecture
            const { SingleCrt, MultipleCrt } = require('../models/crt');
            let existingCertificate = await SingleCrt.findOne({
                userId: userId,
                lectureId: linkedLecture
            });

            // If no certificate exists, generate one
            if (!existingCertificate) {
                const { generateCertificate } = require('../utils/certificateGenerator');
                try {
                    downloadUrl = await generateCertificate(
                        user.name,
                        upcomingLecture.courseName,
                        linkedLecture
                    );

                    // Save the single certificate record
                    const newCertificate = await SingleCrt.create({
                        username: user.name,
                        userId: userId,
                        lectureId: linkedLecture,
                        downloadurl: downloadUrl
                    });

                    // Update or create MultipleCrt record
                    await MultipleCrt.findOneAndUpdate(
                        { userId: userId },
                        { 
                            $set: { username: user.name },
                            $addToSet: { crtId: newCertificate._id }
                        },
                        { upsert: true, new: true }
                    );
                    
                    existingCertificate = newCertificate;
                } catch (certError) {
                    console.error('Error generating certificate:', certError);
                    // Continue even if certificate generation fails
                }
            } else {
                downloadUrl = existingCertificate.downloadurl;
                
                // Ensure the certificate is linked in MultipleCrt
                await MultipleCrt.findOneAndUpdate(
                    { 
                        userId: userId,
                        crtId: { $ne: existingCertificate._id }
                    },
                    { 
                        $set: { username: user.name },
                        $addToSet: { crtId: existingCertificate._id }
                    },
                    { upsert: true, new: true }
                );
            }

            // Send confirmation email with certificate link if available
            const emailContent = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Enrollment Confirmation</h2>
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
                        <p style="font-size: 16px;">Hello ${user.name},</p>
                        <p>You have been successfully enrolled in the lecture:</p>

                        ${courseImage ? `<img src="${courseImage}" alt="Course" style="max-width: 100%; height: auto; margin: 15px 0; border-radius: 5px;">` : ''}
                        
                        <div style="background-color: white; padding: 15px; border-left: 4px solid #3498db; margin: 15px 0;">
                            <h3 style="margin-top: 0; color: #2c3e50;">${upcomingLecture.courseName}</h3>
                            <p><strong>Description:</strong> ${upcomingLecture.courseDescription || 'No description available'}</p>
                            <p><strong>Instructor:</strong> ${upcomingLecture.courseIntructor || 'Myteacher Admin'}</p>
                            <p><strong>Date & Time:</strong> ${new Date(upcomingLecture.startTime).toLocaleString()}</p>
                            <p><strong>Platform:</strong> ${upcomingLecture.platform}</p>
                        </div>
                        
                        <p>We look forward to seeing you in class!</p>
                    </div>
                    
                    <p style="text-align: center; color: #7f8c8d; font-size: 14px;">
                        This is an automated message. Please do not reply to this email.
                    </p>
                </div>
            `;

            await sendEmail({
                to: user.email,
                subject: `Enrollment Confirmation - ${upcomingLecture.courseName}`,
                html: emailContent
            });
        }
        
        res.json({ 
            success: true, 
            message: 'User enrolled in lecture successfully',
            lectureId: linkedLecture || lectureId,
            certificateUrl: downloadUrl || null
        });
    } catch (error) {
        console.error('Error in free-lecture endpoint:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Get all certificates for the authenticated user
router.get('/certificates', authJs, async (req, res) => {
    try {
        const userId = req.decoded.userId; // Get user ID from auth token
        
        // Fetch all certificates for the user and populate lecture details
        const certificates = await SingleCrt.find({ userId })
            .populate('lectureId', 'title description startTime endTime');
            
        res.json({ 
            success: true, 
            count: certificates.length,
            certificates 
        });
    } catch (error) {
        console.error('Error in certificates endpoint:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// Get a specific certificate by lecture ID for the authenticated user
router.get('/certificate/:lectureId', authJs, async (req, res) => {
    try {
        const { lectureId } = req.params;
        const userId = req.decoded.userId;
        
        const certificate = await SingleCrt.findOne({ 
            userId,
            lectureId 
        }).populate('lectureId', 'title description startTime endTime');
        
        if (!certificate) {
            return res.status(404).json({ 
                success: false, 
                message: 'Certificate not found for this lecture' 
            });
        }
        
        res.json({ success: true, certificate });
    } catch (error) {
        console.error('Error in certificate endpoint:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// api for deleting SingleCrt
router.delete('/certificate/:lectureId', authJs, async (req, res) => {
    try {
        const { lectureId } = req.params;
        const userId = req.decoded.userId;
        
        const certificate = await SingleCrt.findOneAndDelete({ 
            userId,
            lectureId 
        });
        
        if (!certificate) {
            return res.status(404).json({ 
                success: false, 
                message: 'Certificate not found for this lecture' 
            });
        }
        
        res.json({ success: true, message: 'Certificate deleted successfully' });
    } catch (error) {
        console.error('Error in delete certificate endpoint:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

module.exports = router;
