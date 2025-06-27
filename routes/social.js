const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const authJs = require('../middlewares/auth');

// Middleware to validate user ID parameter
const validateUserId = (req, res, next) => {
    const { userId } = req.params;
    console.log('Validating user ID:', { 
        userId,
        params: req.params,
        url: req.originalUrl,
        method: req.method 
    });
    
    if (!userId || userId === 'undefined') {
        console.error('User ID is missing or undefined:', { userId, params: req.params });
        return res.status(400).json({ 
            success: false,
            message: 'User ID is required',
            receivedId: userId
        });
    }
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        console.error('Invalid user ID format:', userId);
        return res.status(400).json({ 
            success: false,
            message: 'Invalid user ID format',
            receivedId: userId
        });
    }
    
    next();
};

// Follow a user
router.post('/follow/:userId', authJs, validateUserId, async (req, res) => {
    try {
        // Get current user ID from decoded token (handling different possible fields)
        const currentUserId = req.decoded.id || req.decoded.userId || req.decoded._id;
        
        console.log('Follow request received:', {
            currentUserId,
            targetUserId: req.params.userId,
            decodedToken: req.decoded
        });

        if (!currentUserId) {
            console.error('No user ID found in token:', JSON.stringify(req.decoded, null, 2));
            return res.status(400).json({ 
                success: false,
                message: 'User ID not found in token',
                tokenContents: req.decoded
            });
        }

        // Get the current user
        const currentUser = await User.findById(currentUserId);
        if (!currentUser) {
            return res.status(404).json({ 
                success: false,
                message: 'Current user not found in database',
                userId: currentUserId
            });
        }

        // Get the user to follow
        const userToFollow = await User.findById(req.params.userId);
        if (!userToFollow) {
            console.error('User to follow not found:', req.params.userId);
            return res.status(404).json({ 
                success: false,
                message: 'User to follow not found',
                userId: req.params.userId
            });
        }

        console.log('Users found:', {
            currentUser: currentUser._id,
            userToFollow: userToFollow._id
        });

        // Don't allow following yourself
        if (userToFollow._id.toString() === currentUser._id.toString()) {
            return res.status(400).json({ 
                success: false,
                message: 'You cannot follow yourself' 
            });
        }

        // Check if already following
        const isFollowing = currentUser.following.some(
            id => id && id.toString() === userToFollow._id.toString()
        );

        if (isFollowing) {
            return res.status(400).json({ 
                success: false,
                message: 'Already following this user' 
            });
        }

        // Add to following and followedBy arrays
        currentUser.following.push(userToFollow._id);
        userToFollow.followedBy.push(currentUser._id);

        await Promise.all([
            currentUser.save(),
            userToFollow.save()
        ]);

        console.log('Successfully followed user:', {
            follower: currentUser._id,
            following: userToFollow._id
        });

        res.json({ 
            success: true,
            message: 'Successfully followed user' 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Unfollow a user
router.post('/unfollow/:userId', authJs, validateUserId, async (req, res) => {
    try {
        // Get current user ID from decoded token (handling different possible fields)
        const currentUserId = req.decoded.id || req.decoded.userId || req.decoded._id;
        
        if (!currentUserId) {
            console.error('No user ID found in token:', JSON.stringify(req.decoded, null, 2));
            return res.status(400).json({ 
                success: false,
                message: 'User ID not found in token',
                tokenContents: req.decoded
            });
        }

        // Get the current user
        const currentUser = await User.findById(currentUserId);
        if (!currentUser) {
            return res.status(404).json({ 
                success: false,
                message: 'Current user not found in database',
                userId: currentUserId
            });
        }

        const userToUnfollow = await User.findById(req.params.userId);
        if (!userToUnfollow) {
            return res.status(404).json({ message: 'User to unfollow not found' });
        }

        // Check if actually following
        const isFollowing = currentUser.following.some(
            id => id.toString() === userToUnfollow._id.toString()
        );

        if (!isFollowing) {
            return res.status(400).json({ message: 'Not following this user' });
        }

        // Remove from both arrays
        currentUser.following = currentUser.following.filter(
            id => id.toString() !== userToUnfollow._id.toString()
        );
        userToUnfollow.followedBy = userToUnfollow.followedBy.filter(
            id => id.toString() !== currentUser._id.toString()
        );

        await Promise.all([currentUser.save(), userToUnfollow.save()]);

        res.json({ message: 'Successfully unfollowed user' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get followers of a user
router.get('/followers/:userId', validateUserId, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .select('name email avatar')
            .populate('followedBy', 'name email avatar');
            
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ followers: user.followedBy });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get users that a user is following
router.get('/following/:userId', validateUserId, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .select('name email avatar')
            .populate('following', 'name email avatar');
            
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ following: user.following });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Check if current user is following another user
router.get('/is-following/:userId', authJs, validateUserId, async (req, res) => {
    try {
        // Get the current user with populated following array
        const currentUser = await User.findById(req.decoded.id).select('following');
        if (!currentUser) {
            return res.status(404).json({ message: 'Current user not found' });
        }

        const isFollowing = currentUser.following.some(
            id => id.toString() === req.params.userId
        );
        
        res.json({ isFollowing });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;