const express = require('express');
const router = express.Router();
const axios = require('axios');
const authJs = require('../middlewares/auth');
const Course = require('../models/course');
const Transaction = require('../models/transaction');
const Enrollment = require('../models/enrollment');

// FLUTTERWAVE PAYMENT INITIALIZATION
router.post('/pay/flutterwave', authJs, async (req, res) => {
  try {
    const { userId, courseId, amount } = req.body;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    if (amount !== course.price) {
      return res.status(400).json({ message: 'Incorrect payment amount' });
    }

    const txRef = `fla_${Date.now()}`;

    const response = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref: txRef,
        amount,
        currency: 'NGN',
        redirect_url: 'https://yourdomain.com/flutterwave/callback',
        customer: {
          email: req.user?.email || 'user@example.com' // Use authenticated user email if available
        },
        meta: { userId, courseId }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
        }
      }
    );

    await Transaction.create({
      userId,
      courseId,
      amount,
      currency: 'NGN',
      paymentReference: txRef,
      status: 'pending',
      paymentMethod: 'flutterwave'
    });

    res.json({ link: response.data.data.link });
  } catch (error) {
    console.error('Flutterwave payment init error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Flutterwave payment initiation failed' });
  }
});

// FLUTTERWAVE CALLBACK
router.post('/flutterwave/callback', async (req, res) => {
  try {
    const { data } = req.body;

    if (data.status !== 'successful') return res.sendStatus(200);

    const txRef = data.tx_ref;

    const transaction = await Transaction.findOne({ paymentReference: txRef });
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });

    await Transaction.updateOne({ paymentReference: txRef }, { status: 'completed' });

    const { userId, courseId } = transaction;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const enrolledAt = new Date();
    const expiryDate = new Date(enrolledAt);
    expiryDate.setDate(enrolledAt.getDate() + course.durationWeeks * 7);

    await Enrollment.create({ userId, courseId, enrolledAt, expiryDate });

    res.sendStatus(200);
  } catch (error) {
    console.error('Flutterwave callback error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Callback handling failed' });
  }
});

// PAYSTACK PAYMENT INITIALIZATION
router.post('/pay/paystack', authJs, async (req, res) => {
  try {
    const { userId, courseId } = req.body;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const amount = course.price;
    const currency = 'NGN'; // Or USD depending on your setup

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: req.user?.email || 'user@example.com',
        amount: amount * 100, // In kobo
        currency,
        metadata: { userId, courseId }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

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
router.get('/paystack/callback', authJs, async (req, res) => {
  const { reference } = req.query;

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const paymentData = response.data.data;
    if (paymentData.status !== 'success') {
      return res.send('Payment was not successful.');
    }

    await Transaction.updateOne({ paymentReference: reference }, { status: 'completed' });

    const { userId, courseId } = paymentData.metadata;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).send('Course not found');

    const enrolledAt = new Date();
    const expiryDate = new Date(enrolledAt);
    expiryDate.setDate(enrolledAt.getDate() + course.durationWeeks * 7);

    await Enrollment.create({ userId, courseId, enrolledAt, expiryDate });

    res.send('Payment successful! You are now enrolled.');
  } catch (error) {
    console.error('Paystack callback error:', error.response?.data || error.message);
    res.status(500).send('Verification failed.');
  }
});

module.exports = router;
