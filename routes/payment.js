// const express = require('express');
// const paymentRouter = express.Router();
// const Payment = require('../models/payment');

// paymentRouter.post('/payment', async (req, res) => {
//     try {
//         const payment = new Payment(req.body);
//         await payment.save();
//         res.status(201).send({
//             message: 'successful payment',
//             pay: payment
//         });
//     } catch (err) {
//         res.status(400).send(err);
//     }
// });

// // get all payments
// paymentRouter.get('/payment', async (req, res) => {
//     try {
//         const payments = await Payment.find()
//         res.send(payments);
//     } catch (err) {
//         res.status(500).send(err);
//     }
// })

// // get a single payment by the id
// paymentRouter.get('/:id', async (req, res) => {
//     try {
//         const payment = await Payment.findById(req.params.id);
//         if (!payment) {
//             return res.status(404).send();
//         }
//         res.send(payment);
//     } catch (err) {
//         res.status(500).send(err);
//     }
// });

// // updating of payment by id
// paymentRouter.get('/:id', async (req, res) => {
//     try {
//         const payment = await Payment.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
//         if (!payment) {
//             return res.status(404).send();
//         }
//         res.send(payment);
//     } catch (err) {
//         res.status(400).send(err);
//     }
// })

// // deleting of payment by id
// paymentRouter.get('/:id', async (req, res) => {
//     try {
//         const payment = await Payment.findByIdAndDelete(req.params.id);
//         if (!payment) {
//             return res.status(404).send();
//         }
//         res.send(payment);
//     } catch (err) {
//         res.status(500).send(err);
//     }    
// })

// module.exports = paymentRouter;

const express = require('express');
const paymentRoute = express.Router();
const Payment = require('../models/payment');

// Create a new payment
paymentRoute.post('/create', async (req, res) => {
    try {
        const payment = new Payment({
            amount: req.body.amount,
            currency: req.body.currency
        });
        await payment.save();


        const viewOnly = ({
            _id: payment._id,
            amount: payment.amount,
            currency: payment.currency
        })

        res.status(201).send(viewOnly);
    } catch (error) {
        res.status(400).send(error);
    }
});

// Get all payments
paymentRoute.get('/getpayment', async (req, res) => {
    try {
        const payments = await Payment.find();
        res.send(payments);
    } catch (error) {
        res.status(500).send(error);
    }
});

// Get a single payment by ID
paymentRoute.get('/:id', async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id);
        if (!payment) {
            return res.status(404).send();
        }
        res.send(payment);
    } catch (error) {
        res.status(500).send(error);
    }
});

// Update a payment by ID
paymentRoute.patch('/:id', async (req, res) => {
    try {
        const payment = await Payment.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!payment) {
            return res.status(404).send();
        }
        res.send(payment);
    } catch (error) {
        res.status(400).send(error);
    }
});

// Delete a payment by ID
paymentRoute.delete('/:id', async (req, res) => {
    try {
        const payment = await Payment.findByIdAndDelete(req.params.id);
        if (!payment) {
            return res.status(404).send();
        }
        res.send(payment);
    } catch (error) {
        res.status(500).send(error);
    }
});

module.exports = paymentRoute;
