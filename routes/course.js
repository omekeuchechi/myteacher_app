const express = require('express');
const router = express.Router();
const Course = require('../models/course');
const auth = require('../middlewares/auth');

// Get course by ID
router.get('/:id', auth, async (req, res) => {
  console.log(`Fetching course with ID: ${req.params.id}`);
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      console.log('Invalid course ID format');
      return res.status(400).json({ 
        success: false,
        message: 'Invalid course ID format' 
      });
    }
    
    const course = await Course.findById(req.params.id).lean();
    
    if (!course) {
      console.log(`Course not found with ID: ${req.params.id}`);
      return res.status(404).json({ 
        success: false,
        message: 'Course not found' 
      });
    }
    
    console.log(`Found course: ${course.course || 'Unnamed Course'}`);
    res.json({
      success: true,
      data: course
    });
    
  } catch (error) {
    console.error('Error in GET /courses/:id:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching course',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Search courses by name or get all courses
router.get('/', auth, async (req, res) => {
  console.log('Fetching courses with query:', req.query);
  
  try {
    const { name } = req.query;
    let query = {};
    
    if (name) {
      query.course = { $regex: name, $options: 'i' };
      console.log(`Searching for courses with name containing: ${name}`);
    }
    
    const courses = await Course.find(query).lean();
    console.log(`Found ${courses.length} matching courses`);
    
    res.json({
      success: true,
      count: courses.length,
      data: courses
    });
    
  } catch (error) {
    console.error('Error in GET /courses:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching courses',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
