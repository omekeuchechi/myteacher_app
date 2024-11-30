const express = require('express');
const router = express.Router();
const User = require('../models/user');
const bcrypt = require('bcrypt');

router.post(`/create`, async (req, res) => {
    try{
        const existingUser = await User.find({email: req.body.email});
        
        if(existingUser.length > 0){
            return res.status(400).json({
                message: "Email already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(req.body.password, 12)
        const user = new User({
            name: req.body.name,
            email: req.body.email,
            password: hashedPassword
        })
    
        const response = await user.save();

        const viewResponse = {
            _id: response._id,
            name: response.name,
            email: response.email
        }
    
        res.status(201).json({
            message: "User created successfully",
            user: viewResponse
        })
    }
    catch(err){
        res.status(500).json({
            message: "error creating user",
            error: err
        });
    }
})

module.exports = router;