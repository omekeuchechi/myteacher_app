const express = require('express');
const router = express.Router();
const User = require('../models/user');

router.post(`/`, async (req, res) => {
    
    const user = new User({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password
    })

    const response = await user.save();

    res.status(201).json({
        message: "User created successfully",
        user: response
    })
})

module.exports = router;