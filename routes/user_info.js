const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const User = require('../models/user');
const UserInfo = require('../models/user_info');
const authJs = require('../middlewares/auth');
const multer = require('multer');
const memoryStorage = multer.memoryStorage();
const upload = multer({ storage: memoryStorage });
const cloudinary = require('cloudinary').v2;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
const path = require('path');
const Jimp = require('jimp');
const stream = require('stream');
const Pusher = require('pusher');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Set the path to the ffmpeg binary
ffmpeg.setFfmpegPath(ffmpegPath);

// Helper function to write buffer to a temporary file
function writeTempFile(buffer, extension = 'mp4') {
    return new Promise((resolve, reject) => {
        const tempPath = path.join(os.tmpdir(), `input-${Date.now()}.${extension}`);
        fs.writeFile(tempPath, buffer, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(tempPath);
            }
        });
    });
}

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

// Helper to delete a Cloudinary folder recursively
async function deleteCloudinaryFolder(folderPath, resourceType = 'image') {
    try {
        // List all resources in the folder
        const resources = await cloudinary.api.resources({ type: 'upload', prefix: folderPath, resource_type: resourceType });
        for (const resource of resources.resources) {
            await cloudinary.uploader.destroy(resource.public_id, { resource_type: resourceType });
        }
    } catch (err) {
        console.error(`Cloudinary folder deletion error for ${folderPath} (${resourceType}):`, err);
        throw err;
    }
    // Optionally, delete the folder itself (Cloudinary auto-removes empty folders)
}

// Helper to upload buffer to Cloudinary in a specific folder
async function uploadBufferToCloudinary(buffer, filename, mimetype, folderPath, resourceType = 'auto') {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
            {
                folder: folderPath,
                public_id: path.parse(filename).name,
                resource_type: resourceType,
                overwrite: true,
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result.secure_url);
            }
        ).end(buffer);
    });
}

// Create userInfo (only if not exists)
router.post('/create', authJs, async (req, res) => {
    const userId = req.decoded && req.decoded.userId;
    if (!userId) {
        return res.status(401).json({ message: 'Invalid or missing authentication token.' });
    }
    try {
        const user = await User.findById(userId);
        if (!user) {
            console.error('User not found for decoded:', req.decoded);
            return res.status(404).json({ message: 'User not found for this token.' });
        }
        const existingInfo = await UserInfo.findOne({ createdBy: userId });
        if (existingInfo) {
            return res.status(400).json({ message: 'User info already exists. Please update instead.' });
        }
        const profileInfo = new UserInfo({
            aboutYourSelf: req.body.aboutYourSelf,
            hobbies: req.body.hobbies,
            marritaStatus: req.body.marritaStatus,
            createdBy: userId,
            address: req.body.address,
        });
        const userInfo = await profileInfo.save();
        // Pusher event
        pusher.trigger('user-info', 'created', { userId, userInfo });
        res.status(200).json({
        message: "User info added successfully",
        userInfo: userInfo
        });
    } catch (error) {
        res.status(500).json({
            message: "internal server error",
            error: error
        });
    }
});

// Update userInfo (authenticated user only) - partial updates with PATCH
router.patch('/update', authJs, async (req, res) => {
    const userId = req.decoded.userId;
    try {
        const updateFields = {};
        
        // Only include fields that are provided in the request
        if (req.body.aboutYourSelf !== undefined) updateFields.aboutYourSelf = req.body.aboutYourSelf;
        if (req.body.hobbies !== undefined) updateFields.hobbies = req.body.hobbies;
        if (req.body.marritaStatus !== undefined) updateFields.marritaStatus = req.body.marritaStatus;
        if (req.body.address !== undefined) updateFields.address = req.body.address;

        // If no valid fields to update
        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ message: 'No valid fields provided for update' });
        }

        const updated = await UserInfo.findOneAndUpdate(
            { createdBy: userId },
            { $set: updateFields },
            { new: true, runValidators: true }
        );
        
        if (!updated) {
            return res.status(404).json({ message: 'User info not found. Please create first.' });
        }
        // Pusher event
        pusher.trigger('user-info', 'updated', { userId, userInfo: updated });
        res.status(200).json({
        message: 'User info updated successfully',
        userInfo: updated
        });
    } catch (error) {
        res.status(500).json({
            message: 'internal server error',
            error: error
        });
    }
});

// Fetch authenticated user's userInfo
router.get('/me', authJs, async (req, res) => {
    const userId = req.decoded.userId;
    try {
        let userInfo = await UserInfo.findOne({ createdBy: userId });
        if (!userInfo) {
            // Auto-create blank user info
            userInfo = new UserInfo({ createdBy: userId });
            await userInfo.save();
        }
        res.status(200).json(userInfo);
    } catch (error) {
        res.status(500).json({
            message: 'internal server error',
            error: error
        });
    }
});

// Get user profile by ID
router.get('/profile/:id', authJs, async (req, res) => {
    try {
        const userId = req.params.id;
        if (!userId) {
            return res.status(400).json({ message: 'User ID is required' });
        }

        const userInfo = await UserInfo.findOne({ createdBy: userId })
            .populate('createdBy', 'name email avatar isAdmin');
            
        if (!userInfo) {
            return res.status(404).json({ 
                success: false,
                message: 'User profile not found' 
            });
        }

        res.status(200).json({
            success: true,
            data: userInfo
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// api for fetching user info as admin
router.get('/all-user-info/:id', authJs, async (req, res) => {
    const userId = req.params.id;
    try {
        let userInfo = await UserInfo.find({ createdBy: userId });
        res.status(200).json({
            message: 'User info fetched successfully',
            userInfo: userInfo
        });
    } catch (error) {
        res.status(500).json({
            message: 'internal server error',
            error: error
        });
    }
});

// Search users by name, hobbies, marital status, or address
router.get('/search', authJs, async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ message: 'Search query is required.' });
    }
    try {
        const userId = req.decoded && req.decoded.userId;
        if (!userId) {
            return res.status(403).json({ message: "Unauthorized, user only" });
        }

        const searchRegex = new RegExp(q, 'i');
        
        // Find users whose name matches or whose userInfo matches the search criteria
        const users = await User.aggregate([
            {
                $match: {
                    $or: [
                        { name: { $regex: searchRegex } }
                    ]
                }
            },
            {
                $lookup: {
                    from: 'userinfos',  // This should match your MongoDB collection name for UserInfo
                    localField: '_id',
                    foreignField: 'createdBy',
                    as: 'userInfo'
                }
            },
            { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
            {
                $match: {
                    $or: [
                        { name: { $regex: searchRegex } },
                        { 'userInfo.hobbies': { $regex: searchRegex } },
                        { 'userInfo.marritaStatus': { $regex: searchRegex } },
                        { 'userInfo.address': { $regex: searchRegex } }
                    ]
                }
            },
            {
                $project: {
                    _id: 1,
                    name: 1,
                    email: 1,
                    'userInfo.aboutYourSelf': 1,
                    'userInfo.hobbies': 1,
                    'userInfo.marritaStatus': 1,
                    'userInfo.address': 1,
                    'userInfo.storyImage': 1
                }
            }
        ]);

        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({
            message: 'internal server error',
            error: error
        });
    }
});

// Upload storyImage
router.post('/upload/storyImage', authJs, upload.single('storyImage'), async (req, res) => {
    const userId = req.decoded.userId;
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }
    const folderPath = `${userId}/storyImage`;
    try {
        // Compress image using Jimp
        const image = await Jimp.read(req.file.buffer);
        let quality = 40;
        let compressedBuffer;
        
        // Function to get buffer with quality
        const getCompressedBuffer = async (img, q) => {
            const clone = img.clone();
            return await clone.quality(q).getBufferAsync(Jimp.MIME_JPEG);
        };
        
        // Try initial compression
        compressedBuffer = await getCompressedBuffer(image, quality);
        
        // Reduce quality if needed to get under 20KB
        while (compressedBuffer.length > 20000 && quality > 5) {
            quality -= 5;
            compressedBuffer = await getCompressedBuffer(image, quality);
        }
        // Delete previous storyImage folder
        await deleteCloudinaryFolder(folderPath);
        // Upload new image
        const url = await uploadBufferToCloudinary(compressedBuffer, req.file.originalname, req.file.mimetype, folderPath, 'image');
        // Update UserInfo
        const userInfo = await UserInfo.findOneAndUpdate(
            { createdBy: userId },
            { storyImage: url },
            { new: true }
        );
        if (!userInfo) {
            return res.status(404).json({ message: 'User info not found. Please create first.' });
        }
        // Pusher event
            pusher.trigger('user-info', 'storyImage', { userId, url });
            res.status(200).json({ message: 'Story image uploaded successfully', url });
    } catch (error) {
        res.status(500).json({ message: 'Upload failed', error });
    }
});

// Helper function to compress video buffer
async function compressVideoBuffer(inputBuffer) {
    let tempInputPath = null;
    let tempOutputPath = null;
    
    try {
        if (!inputBuffer || !Buffer.isBuffer(inputBuffer)) {
            throw new Error('Invalid input buffer');
        }

        console.log('Starting video compression. Input buffer size:', inputBuffer.length, 'bytes');
        
        // Write input buffer to a temporary file
        tempInputPath = await writeTempFile(inputBuffer);
        tempOutputPath = path.join(os.tmpdir(), `video-${Date.now()}.mp4`);
        
        console.log('Temporary input file created at:', tempInputPath);
        
        // Create a promise to handle the FFmpeg process
        return new Promise((resolve, reject) => {
            const command = ffmpeg()
                .input(tempInputPath)
                .inputOptions([
                    '-y', // Overwrite output file if it exists
                    '-analyzeduration 100M', // Increase analyze duration
                    '-probesize 100M' // Increase probe size
                ])
                .on('start', (commandLine) => {
                    console.log('FFmpeg command:', commandLine);
                })
                .on('codecData', (data) => {
                    console.log('Input video info:', JSON.stringify(data, null, 2));
                })
                .on('stderr', (stderrLine) => {
                    console.log('FFmpeg stderr:', stderrLine);
                })
                .on('error', (err, stdout, stderr) => {
                    console.error('FFmpeg error:', err);
                    console.error('FFmpeg stdout:', stdout);
                    console.error('FFmpeg stderr:', stderr);
                    reject(new Error(`FFmpeg error: ${err.message}`));
                })
                .output(tempOutputPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-preset medium',
                    '-crf 28',
                    '-b:a 128k',
                    '-movflags frag_keyframe+empty_moov',
                    '-f mp4',
                    '-threads 0' // Use all available CPU threads
                ]);

            console.log('Starting FFmpeg processing...');
            
            command.on('end', async () => {
                try {
                    console.log('FFmpeg processing finished successfully');
                    console.log('Reading output file from:', tempOutputPath);
                    
                    // Read the output file
                    const data = await fs.promises.readFile(tempOutputPath);
                    console.log('Compressed video size:', data.length, 'bytes');
                    
                    // Clean up temp files
                    await Promise.all([
                        fs.promises.unlink(tempInputPath).catch(console.error),
                        fs.promises.unlink(tempOutputPath).catch(console.error)
                    ]);
                    
                    resolve(data);
                } catch (err) {
                    console.error('Error in FFmpeg end handler:', err);
                    reject(new Error('Failed to process video: ' + err.message));
                }
            });

            // Start processing
            command.run();
        });
        
    } catch (error) {
        console.error('Error in compressVideoBuffer:', error);
        
        // Clean up any created temp files
        const cleanup = [];
        if (tempInputPath) cleanup.push(fs.promises.unlink(tempInputPath).catch(console.error));
        if (tempOutputPath) cleanup.push(fs.promises.unlink(tempOutputPath).catch(console.error));
        
        await Promise.all(cleanup);
        
        throw error;
    }
}

// Upload storyVideo
router.post('/upload/storyVideo', authJs, upload.single('storyVideo'), async (req, res) => {
    const userId = req.decoded.userId;
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }
    
    const folderPath = `${userId}/storyVideo`;
    
    try {
        // Delete previous storyVideo folder
        await deleteCloudinaryFolder(folderPath, 'video');
        
        // Compress video to target ~20MB
        const compressedBuffer = await compressVideoBuffer(req.file.buffer);
        
        // Upload to Cloudinary
        const url = await uploadBufferToCloudinary(
            compressedBuffer,
            req.file.originalname,
            req.file.mimetype,
            folderPath,
            'video'
        );
        
        // Update UserInfo
        const userInfo = await UserInfo.findOneAndUpdate(
            { createdBy: userId },
            { storyVideo: url },
            { new: true }
        );
        
        if (!userInfo) {
            return res.status(404).json({ message: 'User info not found. Please create first.' });
        }
        
        // Trigger Pusher event
        pusher.trigger('user-info', 'storyVideo', { userId, url });
        res.status(200).json({ message: 'Story video uploaded successfully', url });
    } catch (error) {
        console.error('Video upload error:', error);
        res.status(500).json({ message: 'Video upload failed', error: error.message || error });
    }
});

module.exports = router;