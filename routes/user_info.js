const express = require('express');
const router = express.Router();
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
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const stream = require('stream');
const Pusher = require('pusher');
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

// Update userInfo (authenticated user only)
router.put('/update', authJs, async (req, res) => {
    const userId = req.decoded.userId;
    try {
        const updated = await UserInfo.findOneAndUpdate(
            { createdBy: userId },
            {
                aboutYourSelf: req.body.aboutYourSelf,
                hobbies: req.body.hobbies,
                marritaStatus: req.body.marritaStatus,
                                address: req.body.address,
            },
            { new: true }
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

// Public search endpoint (by user name, hobbies, marritaStatus, or address)
router.get('/search', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ message: 'Search query required.' });
    }
    try {
        const regex = new RegExp(q, 'i');
        // First, find users whose name matches
        const users = await User.find({ name: regex }, '_id');
        const userIds = users.map(u => u._id);
        // Then, search userInfo by user name, hobbies, marritaStatus, or address
        const results = await UserInfo.find({
            $or: [
                { createdBy: { $in: userIds } },
                { hobbies: regex },
                { marritaStatus: regex },
                { address: regex }
            ]
        }).populate('createdBy', 'name');
        res.status(200).json(results);
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
        // Compress image to ~20KB using sharp
        let compressedBuffer = await sharp(req.file.buffer)
            .jpeg({ quality: 40 }) // Start with moderate quality
            .toBuffer();
        // Iteratively reduce quality if needed
        let quality = 40;
        while (compressedBuffer.length > 20000 && quality > 5) {
            quality -= 5;
            compressedBuffer = await sharp(req.file.buffer)
                .jpeg({ quality })
                .toBuffer();
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

// Upload storyVideo
router.post('/upload/storyVideo', authJs, upload.single('storyVideo'), async (req, res) => {
    const userId = req.decoded.userId;
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }
    const folderPath = `${userId}/storyVideo`;
    try {
    // Delete previous storyVideo folder (resource_type: 'video')
    await deleteCloudinaryFolder(folderPath, 'video');
    // Adaptive compression to ~400KB using ffmpeg
    let targetSize = 400000; // 400KB
    let scale = 320;
    let bitrate = 200; // in kbps
    let compressedBuffer;
    let attempts = 0;
    while (attempts < 6) { // try up to 6 times
    const inputBufferStream = new stream.PassThrough();
    inputBufferStream.end(req.file.buffer);
    let compressedChunks = [];
    await new Promise((resolve, reject) => {
    ffmpeg(inputBufferStream)
    .outputOptions([
    `-vf`, `scale=${scale}:-2`,
    `-b:v`, `${bitrate}k`,
    '-preset', 'ultrafast',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4'
    ])
    .on('error', reject)
    .on('end', resolve)
    .pipe()
    .on('data', chunk => compressedChunks.push(chunk))
    .on('end', resolve);
    });
    compressedBuffer = Buffer.concat(compressedChunks);
    if (compressedBuffer.length <= targetSize) break;
    // Lower quality for next attempt
    bitrate = Math.max(50, Math.floor(bitrate * 0.6));
    scale = Math.max(120, Math.floor(scale * 0.7));
    attempts++;
    }
    if (compressedBuffer.length > targetSize) {
    return res.status(400).json({ message: 'Compressed video is still larger than 400KB. Please upload a smaller/shorter video.' });
    }
    // Upload new video
    const url = await uploadBufferToCloudinary(compressedBuffer, req.file.originalname, req.file.mimetype, folderPath, 'video');
        // Update UserInfo
        const userInfo = await UserInfo.findOneAndUpdate(
            { createdBy: userId },
            { storyVideo: url },
            { new: true }
        );
        if (!userInfo) {
            return res.status(404).json({ message: 'User info not found. Please create first.' });
        }
        // Pusher event
            pusher.trigger('user-info', 'storyVideo', { userId, url });
            res.status(200).json({ message: 'Story video uploaded successfully', url });
    } catch (error) {
        console.error('Story video upload failed:', error);
        res.status(500).json({ message: 'Upload failed', error: error.message || error });
    }
});

module.exports = router;