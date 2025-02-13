const multer = require('multer');  
const fs = require('fs');  
const path = require('path');  

const uploadDir = 'uploads/';
// const appDir = 'appUpload/';  

// Function to delete existing avatar if necessary  
const deleteExistingAvatar = (userId) => {  
    const userAvatarDir = path.join(uploadDir, userId.toString(), 'avatar');  
    if (fs.existsSync(userAvatarDir)) {  
        const files = fs.readdirSync(userAvatarDir);  
        files.forEach(file => {  
            fs.unlinkSync(path.join(userAvatarDir, file));  
        });  
    }  
};


const deleteExistingLogo = (settingId) => {  
    const settingLogoDir = path.join(appDir, settingId.toString(), 'logo');  
    if (fs.existsSync(settingLogoDir)) {  
        const files = fs.readdirSync(settingLogoDir);  
        files.forEach(file => {  
            fs.unlinkSync(path.join(settingLogoDir, file));  
        });  
    }  
};

exports.storage = multer.diskStorage({  
    destination: (req, file, cb) => {  
        const userId = req.decoded.userId;  
        const avatarDir = path.join(uploadDir, userId.toString(), 'avatar');  

        // Ensure top-level upload directory exists  
        if (!fs.existsSync(uploadDir)) {  
            fs.mkdirSync(uploadDir);  
        }  

        // Ensure user-specific directory exists  
        if (!fs.existsSync(path.join(uploadDir, userId.toString()))) {  
            fs.mkdirSync(path.join(uploadDir, userId.toString()));  
        }  

        // Delete existing avatar if it exists  
        if (file.fieldname === 'avatar') {  
            deleteExistingAvatar(userId);  
        }  

        // Ensure avatar directory exists  
        if (!fs.existsSync(avatarDir)) {  
            fs.mkdirSync(avatarDir);  
        }  

        cb(null, avatarDir);
        
        
    },  

    filename: (req, file, cb) => {  
        const fileExt = path.extname(file.originalname);  
        const baseFileName = path.basename(file.originalname, fileExt);  
        const fileName = `${baseFileName}${fileExt}`;  

        cb(null, fileName);  
    }  
});


exports.fileFilter = (req, file, cb) => {  
    let allowedTypes;  

    // Validate avatar field type and allowed file types

    if (file.fieldname === 'avatar') {  
        allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];  

        if (allowedTypes.includes(file.mimetype)) {  
            cb(null, true);  
        } else {  
            cb(new Error('Invalid file type. Only PNG, JPEG, and JPG are allowed.'), false);  
        }  
    } else {  
        cb(new Error('Invalid field name. Use "avatar" field for uploading an avatar.'), false);  
    }  

};


// for logo storage
exports.logoStorage = multer.diskStorage({  
    destination: (req, file, cb) => {  
        const settingId = process.env.SETTING_SECRET_ID;  
        const logoDir = path.join(uploadDir, settingId.toString(), 'logo');  

        // Ensure top-level upload directory exists  
        if (!fs.existsSync(uploadDir)) {  
            fs.mkdirSync(uploadDir);  
        }  

        // Ensure settingapplogo-specific directory exists  
        if (!fs.existsSync(path.join(uploadDir, settingId.toString()))) {  
            fs.mkdirSync(path.join(uploadDir, settingId.toString()));  
        }  

        // Delete existing logo if it exists  
        if (file.fieldname === 'logo') {  
            deleteExistingLogo(settingId);  
        }  

        // Ensure logo directory exists  
        if (!fs.existsSync(logoDir)) {  
            fs.mkdirSync(logoDir);  
        }  

        cb(null, logoDir);
        
    },  

    filename: (req, file, cb) => {  
        const fileExt = path.extname(file.originalname);  
        const baseFileName = path.basename(file.originalname, fileExt);  
        const fileName = `${baseFileName}${fileExt}`;  

        cb(null, fileName);  
    }  
});


exports.logoFileFilter = (req, file, cb) => {
    let allowedTypes;
    if (file.fieldname === 'logo') {  
        allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];  

        if (allowedTypes.includes(file.mimetype)) {  
            cb(null, true);  
        } else {  
            cb(new Error('Invalid file type. Only PNG, JPEG, and JPG are allowed.'), false);  
        }  
    } else {  
        cb(new Error('Invalid field name. Use "logo" field for uploading a logo.'), false);  
    }
}


























































// const multer = require('multer');
// const fs = require('fs');
// const path = require('path');

// exports.storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         const uploadDir = 'uploads/';
//         const userId = req.decoded.userId;
//         let uploadPath;
//         if (!fs.existsSync(uploadDir)) {
//             fs.mkdirSync(uploadDir);
//         }

//         // upload

//         if (fs.existsSync(uploadDir)){
//             uploadPath = `${uploadDir}${userId}`;
//             if (!fs.existsSync(uploadPath)) {
//                 fs.mkdirSync(uploadPath);
//             }
//         }

//         if (fs.existsSync(uploadPath) && file.fieldname == 'avater') {
//             uploadPath = `${uploadPath}/avater`;
//             if (!fs.existsSync(uploadPath)) {
//                 fs.mkdirSync(uploadPath);
//             } else if (fs.existsSync(uploadPath) && file.fieldname == 'files') {
//                 uploadPath = `${uploadPath}/files`;
//                 if (!fs.existsSync(uploadPath)) {
//                     fs.mkdirSync(uploadPath);
//                 }
//             }


//             cb(null, uploadPath);

//         }

//     },

//     filename: (req, file, cb) => {
//         const fileExt = path.extname(file.originalname);
//         const spliteFileName = file.originalname.split('.');
//         const fileName = spliteFileName.split(' ')[0] + fileExt;

//         cb(null, fileName);
//     }
//  });

//  exports.fileFilter = (req, file, cb) => {
//     let allowedTypes;

//     if (file.fieldname == 'avater') {
//         allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];

//         if (allowedTypes.includes(file.mimetype)) {
//             cb(null, true);
//         } else{
//             cb(new Error('Invalid file type. Only PNG, JPEG, and JPG are allowed.'), false);
//         }
//     }
//  }