const express = require('express');
const router = express.Router();
const authJs = require('../middlewares/auth');
// const Post = require('../models/post');
const User = require('../models/user');
const Setting = require('../models/setting');
const multer  = require('multer');
// const { storage, fileFilter} = require('../middlewares/multerStorage');
const { logoStorage, logoFileFilter } = require('../middlewares/multerStorage');



// const upload = multer({ storage, fileFilter });
const settingUpload = multer({ logoStorage, logoFileFilter });

router.post('/create', authJs, async (req, res) => {  
    try {  
        // Assuming you are using JWT and your middleware decodes the user info  
        const userId = req.decoded.userId; // Get userId from the decoded token  
        const isAdmin = req.decoded.isAdmin;  

        if (!isAdmin) {  
            return res.status(403).send("Unauthorized, you are not an admin");  
        }  

        // Ensure that appName and owner are provided in the body  
        const { appName, owner } = req.body;  
        if (!appName || !owner) {  
            return res.status(400).json({ message: "appName and owner are required" });  
        }  

        // Create and save the new setting  
        const setting = new Setting({  
            appName,  
            owner,  
            // Include other required fields if necessary  
        });  

        const response = await setting.save();  

        // Respond with success message  
        res.status(201).json({  
            message: "App setting configured 🧨 successfully",  
            appConfig: response  
        });  
    } catch (error) {  
        console.error(error); // Log the error for debugging  
        res.status(500).json({  
            message: "Error configuring 🎃 app",  
            error: error.message // Returning just the error message to avoid leaking information  
        });  
    }  
});

router.get('/', authJs, async (req, res)=> {
    const isAdmin = req.decoded.isAdmin;
    
    if(!isAdmin){
        return res.status(400).send("You are not an admin");
    }

    const setting = await Setting.find();

    res.status(200).json({
        message: "App settings fetched successfully",   
        settings: setting
    })
});

router.patch('/update_settings/logo', authJs, settingUpload.single('logo'), async (req, res) => {
    const isAdmin = req.decoded.isAdmin;
    const userInfo = req.body;

    if (!isAdmin) {  
        return res.status(403).send("Unauthorized, you are not an admin");  
    }

    const setting = await Setting.where('_id').equals(process.env.SETTING_SECRET_ID).findOne();

    for (let propName in userInfo) {
        switch (propName) {
            case 'logo':
                setting.logo = userInfo.logo;
                break;
            default:
                // Do nothing for other properties
                break;
        }
    }

    try {
        const response = await setting.save();
        res.status(200).json({ message: "Logo updated successfully", 
        logo: response,
     });
    } catch (error) {
        res.status(500).json({
            message: "Something occurred could not update logo 🎃", 
            error: error
        });
    }
});
module.exports = router;