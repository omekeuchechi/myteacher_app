const express = require('express');
const router = express.Router();
const UpcomingLectureBatch = require('../models/upcomingLectureBatch');
const authJs = require('../middlewares/auth');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer to use memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper function to upload to Cloudinary
const uploadToCloudinary = (fileBuffer, folderPath) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: folderPath },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};

// CREATE a new upcoming lecture batch (Admin only)
router.post('/create', authJs, upload.single('courseImage'), async (req, res) => {
  if (!req.decoded.isAdmin) {
    return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
  }

  try {
    const { courseId, courseName, courseDescription, courseIntructor, startTime, platform } = req.body;
    let courseImageUrl = '';

    if (req.file) {
      const folderPath = `UpcomingLectureBatch/${courseId.replace(/\s+/g, '_')}`;
      const result = await uploadToCloudinary(req.file.buffer, folderPath);
      courseImageUrl = result.secure_url;
    }

    const newBatch = new UpcomingLectureBatch({
      courseId,
      courseName,
      courseDescription,
      courseIntructor,
      startTime,
      platform,
      courseImage: courseImageUrl
    });

    await newBatch.save();
    res.status(201).json(newBatch);
  } catch (error) {
    console.error('Error creating upcoming lecture batch:', error);
    res.status(500).json({ message: 'Failed to create upcoming lecture batch', error: error.message });
  }
});

// GET all upcoming lecture batches
router.get('/', async (req, res) => {
  try {
    const batches = await UpcomingLectureBatch.find().sort({ startTime: 1 });
    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch batches', error: error.message });
  }
});

// UPDATE an upcoming lecture batch (Admin only)
router.put('/:id', authJs, upload.single('courseImage'), async (req, res) => {
  if (!req.decoded.isAdmin) {
    return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
  }

  try {
    const updateData = { ...req.body };
    if (req.file) {
        const batch = await UpcomingLectureBatch.findById(req.params.id);
        if (!batch) return res.status(404).json({ message: 'Batch not found' });

        const folderPath = `UpcomingLectureBatch/${batch.courseId.replace(/\s+/g, '_')}`;
        const result = await uploadToCloudinary(req.file.buffer, folderPath);
        updateData.courseImage = result.secure_url;
    }

    const updatedBatch = await UpcomingLectureBatch.findByIdAndUpdate(req.params.id, updateData, { new: true });

    if (!updatedBatch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    res.json(updatedBatch);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update batch', error: error.message });
  }
});

// DELETE an upcoming lecture batch (Admin only)
router.delete('/:id', authJs, async (req, res) => {
  if (!req.decoded.isAdmin) {
    return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
  }

  try {
    const batch = await UpcomingLectureBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    // Delete the folder from Cloudinary
    if (batch.courseImage) {
        const folderPath = `UpcomingLectureBatch/${batch.courseId.replace(/\s+/g, '_')}`;
        // This deletes all resources in the folder, then the folder itself.
        await cloudinary.api.delete_resources_by_prefix(folderPath);
        await cloudinary.api.delete_folder(folderPath);
    }

    await UpcomingLectureBatch.findByIdAndDelete(req.params.id);

    res.json({ message: 'Batch deleted successfully' });
  } catch (error) {
    console.error('Error deleting batch:', error);
    res.status(500).json({ message: 'Failed to delete batch', error: error.message });
  }
});

// BOOK an upcoming lecture batch (Authenticated users)
router.patch('/:id/book', authJs, async (req, res) => {
  try {
    const batch = await UpcomingLectureBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ message: 'Batch not found' });
    }

    const userId = req.decoded.userId;

    // Check if user is already booked
    if (batch.booked.includes(userId)) {
      return res.status(400).json({ message: 'You have already booked this lecture' });
    }

    // Add user to the booked list
    batch.booked.push(userId);
    await batch.save();

    res.json(batch);
  } catch (error) {
    console.error('Error booking lecture batch:', error);
    res.status(500).json({ message: 'Failed to book lecture batch', error: error.message });
  }
});

// Auto-delete expired batches (observer pattern)
const schedule = require('node-schedule');

// Schedule a job to run every day at midnight
schedule.scheduleJob('0 0 * * *', async () => {
  console.log('Running scheduled job to delete expired lecture batches...');
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const expiredBatches = await UpcomingLectureBatch.find({ startTime: { $lt: sevenDaysAgo } });

    for (const batch of expiredBatches) {
      // Delete from Cloudinary
      if (batch.courseImage) {
        const folderPath = `UpcomingLectureBatch/${batch.courseId.replace(/\s+/g, '_')}`;
        await cloudinary.api.delete_resources_by_prefix(folderPath);
        await cloudinary.api.delete_folder(folderPath);
      }
      // Delete from DB
      await UpcomingLectureBatch.findByIdAndDelete(batch._id);
      console.log(`Deleted expired batch: ${batch.courseId || batch.courseName} (ID: ${batch._id})`);
    }
  } catch (error) {
    console.error('Error in scheduled job for deleting expired batches:', error);
  }
});

module.exports = router;