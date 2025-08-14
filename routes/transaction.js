const express = require('express');
const router = express.Router();
const axios = require('axios');
const authJs = require('../middlewares/auth');
const Course = require('../models/course');
const Transaction = require('../models/transaction');
const Enrollment = require('../models/enrollment');
const Lecture = require('../models/lecture'); // Import Lecture model
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
    const { userId, courseId } = req.body;

    // Check for existing enrollment within last 5 days
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    
    const existingEnrollment = await Enrollment.findOne({
      userId,
      courseId,
      enrolledAt: { $gte: fiveDaysAgo }
    });

    if (existingEnrollment) {
      return res.status(400).json({ 
        message: 'You are already enrolled in this course within the last 5 days',
        enrolledAt: existingEnrollment.enrolledAt
      });
    }

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const amount = course.price;
    const currency = 'NGN'; // Or USD depending on your setup

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: req.user?.email || req.body.email || 'user@example.com',
        amount: amount * 100, // In kobo
        currency,
        metadata: { userId, courseId }
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
      courseId,
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
      expiryDate 
    });

    // Add user to all active lecture batches for this course
    const currentDate = new Date();
    const updatedLectures = await Lecture.findAndUpdateMany(
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



module.exports = router;
